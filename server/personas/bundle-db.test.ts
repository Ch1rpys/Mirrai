import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { uploadRoot } = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const pathMod = require("node:path") as typeof import("node:path");
  return { uploadRoot: mkdtempSync(pathMod.join(tmpdir(), "mirrai-bundle-uploads-")) };
});

vi.mock("../_core/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_core/env")>();
  return { ...actual, ENV: { ...actual.ENV, uploadDir: uploadRoot } };
});

import {
  countRecords,
  createCollectedMessages,
  createMemory,
  createPersona,
  createUser,
  deleteUserAccount,
  getMemoriesByPersonaId,
  getPersonaById,
  getPersonaSettings,
  getPersonaStyleProfile,
  getPersonasByUserId,
  linkMemoryMedia,
  listCollectedRecordIds,
  listMedia,
  listStickers,
  listMemoryMediaForMemories,
  upsertMedia,
  upsertSticker,
  updatePersona,
  purgePersona,
} from "../db";
import { resolveStoredPath } from "../storage";
import { buildSystemPrompt } from "../_core/persona-utils";
import { measureStyleProfile } from "../_core/style-profile";
import { exportPersonaBundle, importPersonaBundle } from "./bundle";
import { PERSONA_BUNDLE_PARTS, writePersonaBundle, extractPersonaBundle } from "../_core/bundle";
import { BackupPassphraseError } from "../_core/backup-format";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";

const DATABASE_URL = process.env.DATABASE_URL;

function sha256OfFile(relKey: string): string {
  const abs = resolveStoredPath(relKey);
  if (!abs) throw new Error(`no file for ${relKey}`);
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function writeFile(relKey: string, bytes: Buffer): string {
  const abs = resolveStoredPath(relKey);
  if (!abs) throw new Error(`unsafe key ${relKey}`);
  const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return relKey;
}

/** Every number stored under a `recordId` key, anywhere in an object. */
function recordIdsIn(value: unknown, out: number[] = []): number[] {
  if (Array.isArray(value)) {
    for (const item of value) recordIdsIn(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "recordId" && typeof item === "number") out.push(item);
    else recordIdsIn(item, out);
  }
  return out;
}

describe.skipIf(!DATABASE_URL)("a persona bundle, against the database (C9.5)", () => {
  let dir: string;
  let userA = 0;
  let userB = 0;

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "mirrai-bundle-db-"));
  });

  afterAll(async () => {
    if (userA) await deleteUserAccount(userA).catch(() => undefined);
    if (userB) await deleteUserAccount(userB).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
    rmSync(uploadRoot, { recursive: true, force: true });
  });

  /**
   * A persona with everything a bundle can carry.
   *
   * Sixty lines from the other side is the fingerprint's minimum, so the
   * import has something to measure afterwards.
   */
  async function seed(userId: number) {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
    const personaId = await createPersona({
      userId,
      name: "小满",
      relationshipDesc: "恋人",
      togetherFrom: "2022-03",
      togetherTo: null,
      timezone: "Asia/Shanghai",
      personaData: {},
      analysisStatus: "ready",
    } as never);

    const rows = [];
    for (let index = 0; index < 60; index += 1) {
      rows.push({
        userId,
        personaId,
        source: "test",
        role: "assistant",
        kind: "text",
        content: `我在呢 ${index}`,
        timestamp: new Date(Date.UTC(2022, 2, 1, 12, 0, index)),
        speaker: "小满",
        lineNo: index * 2 + 1,
        meta: null,
      });
      rows.push({
        userId,
        personaId,
        source: "test",
        role: "user",
        kind: "text",
        content: `今天怎么样 ${index}`,
        timestamp: new Date(Date.UTC(2022, 2, 1, 12, 0, index + 30)),
        speaker: "阿树",
        lineNo: index * 2 + 2,
        meta: null,
      });
    }
    await createCollectedMessages(rows as never);
    const recordIds = await listCollectedRecordIds(personaId, userId);

    const memoryId = await createMemory({
      userId,
      personaId,
      title: "第一次见面",
      description: "在咖啡店",
      category: "memory",
      date: null,
      messageId: null,
      importance: 2,
      isPinned: false,
      factKey: null,
      status: "active",
      subject: "them",
      source: "chat",
      mentionCount: 3,
      entities: ["咖啡店"],
      recordId: recordIds[0],
    } as never);

    // Media attached to the memory, with its bytes on disk.
    const mediaKey = writeFile(
      `personas/${userId}/${personaId}/tests/photo.png`,
      Buffer.from([9, 8, 7, 6, 5]),
    );
    const media = await upsertMedia({
      userId,
      personaId,
      kind: "photo",
      fileKey: mediaKey,
      mime: "image/png",
      bytes: 5,
      hash: createHash("sha256").update(Buffer.from([9, 8, 7, 6, 5])).digest("hex"),
      at: new Date("2022-04-02T10:00:00Z"),
      recordId: recordIds[1],
      fileId: null,
      fromThem: false,
      durationSec: null,
      width: null,
      height: null,
      transcript: null,
      transcriptEngine: null,
      exif: null,
    } as never);
    await linkMemoryMedia({ userId, personaId, memoryId, mediaId: media.id });

    const stickerBytes = Buffer.from([4, 3, 2, 1]);
    const stickerKey = writeFile(
      `personas/${userId}/${personaId}/tests/sticker.png`,
      stickerBytes,
    );
    await upsertSticker({
      userId,
      personaId,
      key: "狗狗探头",
      label: "狗狗探头",
      fileKey: stickerKey,
      mime: "image/png",
      usesByThem: 7,
      usesByMe: 1,
      firstUsedAt: new Date("2022-05-01T00:00:00Z"),
      lastUsedAt: new Date("2022-06-01T00:00:00Z"),
      enabled: true,
    } as never);

    await updatePersona(personaId, userId, {
      personaData: {
        personality: "外冷内热",
        speakingStyle: "短句",
        evidence: [{ field: "personality", recordId: recordIds[2], quote: "我在呢 2" }],
      },
      settings: {
        consent: "asked_yes",
        locked: true,
        providers: { planner: "local" },
        keptQuotes: [{ recordId: recordIds[3], text: "下次带你去吃那家面" }],
      },
    } as never);

    return { personaId, recordIds, memoryId, media, stickerBytes, stamp };
  }

  it("round-trips records, memories, stickers, media and references", async () => {
    userA = await createUser({ username: `bundle-a-${Date.now()}`, passwordHash: "x", name: "阿树" });
    const seeded = await seed(userA);
    const outPath = path.join(dir, "one.mirrai-persona");
    const written = await exportPersonaBundle({
      personaId: seeded.personaId,
      userId: userA,
      include: { memories: true, records: true, conversation: false },
      passphrase: "bundle passphrase",
      outPath,
    });
    expect(written.fileName).toMatch(/\.mirrai-persona$/);
    expect(written.manifest.counts.records).toBe(120);
    expect(written.manifest.counts.memories).toBe(1);
    expect(written.manifest.counts.stickers).toBe(1);

    const imported = await importPersonaBundle({
      userId: userA,
      filePath: outPath,
      passphrase: "bundle passphrase",
    });
    expect(imported.personaId).not.toBe(seeded.personaId);
    const importedPersona = await getPersonaById(imported.personaId, userA);
    expect(importedPersona?.name).toBe("小满");

    // Records: same number, and they are this persona's own rows.
    expect(await countRecords(imported.personaId, userA, { register: "all" })).toBe(120);
    const newRecordIds = await listCollectedRecordIds(imported.personaId, userA);
    expect(newRecordIds).toHaveLength(120);
    const overlap = newRecordIds.filter((id) => seeded.recordIds.includes(id));
    expect(overlap).toEqual([]);

    // Memories point at the new rows, not the old ones.
    const memories = await getMemoriesByPersonaId(imported.personaId, userA, 100);
    expect(memories).toHaveLength(1);
    expect(newRecordIds).toContain(memories[0].recordId);
    expect(seeded.recordIds).not.toContain(memories[0].recordId);

    // The portrait's evidence and the kept quote were rewritten too.
    const importedData = (await getPersonaById(imported.personaId, userA))?.personaData as
      | Record<string, unknown>
      | undefined;
    const portraitIds = recordIdsIn(importedData);
    expect(portraitIds.length).toBeGreaterThan(0);
    for (const id of portraitIds) expect(newRecordIds).toContain(id);
    const importedSettings = await getPersonaSettings(imported.personaId, userA);
    const keptQuotes = (importedSettings?.keptQuotes ?? []) as Array<{ recordId: number | null; text: string }>;
    expect(keptQuotes[0].text).toBe("下次带你去吃那家面");
    expect(newRecordIds).toContain(keptQuotes[0].recordId);
    // The consent choice travels; this machine's lock and provider names do not.
    expect(importedSettings?.consent).toBe("asked_yes");
    expect(importedSettings?.locked).toBeUndefined();
    expect(importedSettings?.providers).toBeUndefined();

    // The sticker's bytes are the same bytes, under this install's keys.
    const stickers = await listStickers(imported.personaId, userA);
    expect(stickers).toHaveLength(1);
    expect(stickers[0].fileKey).not.toBeNull();
    expect(sha256OfFile(stickers[0].fileKey!)).toBe(
      createHash("sha256").update(seeded.stickerBytes).digest("hex"),
    );

    // Media and the memory↔media link.
    const media = await listMedia(imported.personaId, userA);
    expect(media).toHaveLength(1);
    expect(media[0].fileKey).not.toBe(seeded.media.fileKey);
    expect(sha256OfFile(media[0].fileKey)).toBe(seeded.media.hash);
    const links = await listMemoryMediaForMemories([memories[0].id], userA);
    expect(links).toHaveLength(1);
    expect(links[0].mediaId).toBe(media[0].id);

    // The style profile was measured here, not carried in the file.
    const style = await getPersonaStyleProfile(imported.personaId, userA);
    expect(style?.fingerprint).toBeTruthy();

    // The two personas produce the same prompt once the ids are mapped.
    // The import measures the style profile; measure the source too, so
    // the comparison is of the same kind of persona.
    await measureStyleProfile({ personaId: seeded.personaId, userId: userA, force: true });
    const sourcePersona = await getPersonaById(seeded.personaId, userA);
    const sourcePrompt = buildSystemPrompt(sourcePersona, { locale: "zh" });
    const importedPrompt = buildSystemPrompt(importedPersona, { locale: "zh" });
    const mapped = seeded.recordIds.reduce((text, oldId, index) => {
      const newId = newRecordIds[index];
      return text.split(`"${oldId}"`).join(`"${newId}"`).split(`:${oldId}`).join(`:${newId}`);
    }, sourcePrompt);
    // What differs after the mapping is only this install's own state.
    expect(importedPrompt.length).toBeGreaterThan(0);
    expect(mapped).toBe(importedPrompt);
  });

  it("round-trips the fixture-sized persona, whose bundle is bigger than one read chunk", async () => {
    // The manual's round trip uses the xiaoman fixture. Its records make an
    // archive bigger than the 64 KiB chunk `createReadStream` hands out; the
    // importer used to wait for a file to finish before pulling the next
    // chunk, which never happened, so a real-sized bundle hung for ever.
    const owner = await createUser({
      username: `bundle-big-${Date.now()}-${Math.floor(Math.random() * 100_000)}`,
      passwordHash: "x",
      name: "阿树",
    });
    try {
      const personaId = await createPersona({
        userId: owner,
        name: "小满",
        relationshipDesc: "恋人",
        togetherFrom: "2022-03",
        togetherTo: null,
        timezone: "Asia/Shanghai",
        personaData: {},
        analysisStatus: "ready",
      } as never);
      const fixture = buildXiaomanRecords();
      const rows = fixture.map((record) => ({
        userId: owner,
        personaId,
        source: "test",
        role: record.role,
        kind: record.kind,
        content: record.content,
        timestamp: record.timestamp,
        speaker: record.speaker,
        lineNo: record.id,
        meta: record.meta ?? null,
      }));
      for (let offset = 0; offset < rows.length; offset += 500) {
        await createCollectedMessages(rows.slice(offset, offset + 500) as never);
      }

      const outPath = path.join(dir, "fixture.mirrai-persona");
      const written = await exportPersonaBundle({
        personaId,
        userId: owner,
        include: { memories: false, records: true, conversation: false },
        passphrase: "a fixture-sized bundle",
        outPath,
      });
      expect(written.bytes).toBeGreaterThan(64 * 1024);
      expect(written.manifest.counts.records).toBe(fixture.length);

      const imported = await importPersonaBundle({
        userId: owner,
        filePath: outPath,
        passphrase: "a fixture-sized bundle",
      });
      expect(await countRecords(imported.personaId, owner, { register: "all" })).toBe(fixture.length);
      const oldIds = await listCollectedRecordIds(personaId, owner);
      const newIds = await listCollectedRecordIds(imported.personaId, owner);
      expect(newIds.filter((id) => oldIds.includes(id))).toEqual([]);
      await purgePersona(imported.personaId, owner);
    } finally {
      await deleteUserAccount(owner).catch(() => undefined);
    }
  }, 120_000);

  it("imports into another account, and the rows belong to that account", async () => {
    userB = await createUser({ username: `bundle-b-${Date.now()}`, passwordHash: "x", name: "路人" });
    const outPath = path.join(dir, "two.mirrai-persona");
    const seeded = await seed(userA);
    await exportPersonaBundle({
      personaId: seeded.personaId,
      userId: userA,
      include: { memories: true, records: true, conversation: false },
      passphrase: "two's passphrase",
      outPath,
    });
    const imported = await importPersonaBundle({
      userId: userB,
      filePath: outPath,
      passphrase: "two's passphrase",
    });
    expect(await getPersonaById(imported.personaId, userB)).toBeTruthy();
    expect(await getPersonaById(imported.personaId, userA)).toBeUndefined();
    expect(await countRecords(imported.personaId, userB, { register: "all" })).toBe(120);
    expect(await getPersonasByUserId(userB)).toHaveLength(1);
  });

  it("imports a bundle without records with no exemplars and no fingerprint", async () => {
    const outPath = path.join(dir, "three.mirrai-persona");
    const seeded = await seed(userA);
    await exportPersonaBundle({
      personaId: seeded.personaId,
      userId: userA,
      include: { memories: true, records: false, conversation: false },
      passphrase: null,
      outPath,
    });
    const imported = await importPersonaBundle({ userId: userA, filePath: outPath, passphrase: null });
    expect(await countRecords(imported.personaId, userA, { register: "all" })).toBe(0);
    const style = await getPersonaStyleProfile(imported.personaId, userA);
    expect(style?.fingerprint).toBeFalsy();
    const memory = (await getMemoriesByPersonaId(imported.personaId, userA, 10))[0];
    // The text stays; the line it came from cannot.
    expect(memory.title).toBe("第一次见面");
    expect(memory.recordId).toBeNull();
    const personaRow = await getPersonaById(imported.personaId, userA);
    expect(buildSystemPrompt(personaRow, { locale: "zh" }).length).toBeGreaterThan(0);
  });

  it("refuses a wrong passphrase and leaves no persona behind", async () => {
    const outPath = path.join(dir, "four.mirrai-persona");
    const seeded = await seed(userA);
    await exportPersonaBundle({
      personaId: seeded.personaId,
      userId: userA,
      include: { memories: false, records: false, conversation: false },
      passphrase: "the right passphrase",
      outPath,
    });
    const before = (await getPersonasByUserId(userA)).length;
    await expect(
      importPersonaBundle({ userId: userA, filePath: outPath, passphrase: "the wrong one" }),
    ).rejects.toBeInstanceOf(BackupPassphraseError);
    expect((await getPersonasByUserId(userA)).length).toBe(before);
  });

  it("refuses a changed bundle and an unsafe entry, and leaves no persona behind", async () => {
    const seeded = await seed(userA);
    const before = (await getPersonasByUserId(userA)).length;
    expect(seeded.personaId).toBeGreaterThan(0);
    // A part whose bytes no longer match the manifest: deterministic,
    // where flipping a random byte could hit a zip field nobody reads.
    const original = Buffer.from(JSON.stringify({ name: "小满" }), "utf-8");
    const changed = path.join(dir, "five-changed.mirrai-persona");
    writeFileSync(changed, zipSync({
      "manifest.json": strToU8(JSON.stringify({
        kind: "persona",
        format: 1,
        createdAt: new Date().toISOString(),
        appVersion: "test",
        encrypted: false,
        source: { personaId: 1, name: "小满" },
        includes: { memories: false, records: false, conversation: false },
        counts: { records: 0, memories: 0, messages: 0, stickers: 0, media: 0 },
        parts: [{
          file: PERSONA_BUNDLE_PARTS.persona,
          bytes: original.length,
          sha256: createHash("sha256").update(original).digest("hex"),
        }],
        files: [],
      })),
      [PERSONA_BUNDLE_PARTS.persona]: strToU8(JSON.stringify({ name: "改过的" })),
    }));
    await expect(
      importPersonaBundle({ userId: userA, filePath: changed, passphrase: null }),
    ).rejects.toThrow(/was changed/);
    expect((await getPersonasByUserId(userA)).length).toBe(before);

    // An entry that would land outside the staging directory.
    const unsafe = path.join(dir, "five-unsafe.mirrai-persona");
    {
      const manifest = {
        kind: "persona",
        format: 1,
        createdAt: new Date().toISOString(),
        appVersion: "test",
        encrypted: false,
        source: { personaId: 1, name: "x" },
        includes: { memories: false, records: false, conversation: false },
        counts: { records: 0, memories: 0, messages: 0, stickers: 0, media: 0 },
        parts: [],
        files: [],
      };
      writeFileSync(unsafe, zipSync({
        "manifest.json": strToU8(JSON.stringify(manifest)),
        "../evil.txt": strToU8("no"),
      }));
    }
    await expect(
      importPersonaBundle({ userId: userA, filePath: unsafe, passphrase: null }),
    ).rejects.toThrow(/unsafe path/);
    expect((await getPersonasByUserId(userA)).length).toBe(before);
  });

  it("carries the conversation when it is asked for, with reply links remapped", async () => {
    const outPath = path.join(dir, "six.mirrai-persona");
    const seeded = await seed(userA);
    // Two messages, the second answering the first.
    const { createMessage } = await import("../db");
    const first = await createMessage({
      userId: userA,
      personaId: seeded.personaId,
      role: "user",
      content: "在吗",
      messageType: "text",
      channel: "web",
    } as never);
    const photoBytes = Buffer.from([7, 7, 7, 7]);
    const photoKey = writeFile(
      `personas/${userA}/${seeded.personaId}/tests/chat-photo.png`,
      photoBytes,
    );
    await createMessage({
      userId: userA,
      personaId: seeded.personaId,
      role: "assistant",
      content: "[image]",
      messageType: "image",
      mediaUrl: `/uploads/${photoKey}`,
      channel: "web",
      replyToId: first,
    } as never);
    await exportPersonaBundle({
      personaId: seeded.personaId,
      userId: userA,
      include: { memories: false, records: false, conversation: true },
      passphrase: null,
      outPath,
    });
    const imported = await importPersonaBundle({ userId: userA, filePath: outPath, passphrase: null });
    const { getMessagesByPersonaId } = await import("../db");
    const messages = await getMessagesByPersonaId(imported.personaId, userA, 10);
    expect(messages).toHaveLength(2);
    expect(messages[1].replyToId).toBe(messages[0].id);
    expect(messages[1].replyToId).not.toBe(first);
    // The picture travelled too, under this persona's own path.
    expect(messages[1].mediaUrl).toMatch(/^\/uploads\/personas\//);
    const importedPhotoKey = String(messages[1].mediaUrl).replace(/^\/uploads\//, "");
    expect(sha256OfFile(importedPhotoKey)).toBe(
      createHash("sha256").update(photoBytes).digest("hex"),
    );
  });

  it("is still readable as a bundle after a plain round trip of the format", async () => {
    // The container was tested on its own in `server/_core/bundle.test.ts`;
    // this confirms the real export produces the parts the importer reads.
    const seeded = await seed(userA);
    const outPath = path.join(dir, "seven.mirrai-persona");
    await exportPersonaBundle({
      personaId: seeded.personaId,
      userId: userA,
      include: { memories: true, records: true, conversation: false },
      passphrase: null,
      outPath,
    });
    const staging = path.join(dir, "seven-staging");
    const { manifest } = await extractPersonaBundle({ filePath: outPath, stagingDir: staging });
    const names = manifest.parts.map((part) => part.file);
    expect(names).toContain(PERSONA_BUNDLE_PARTS.persona);
    expect(names).toContain(PERSONA_BUNDLE_PARTS.records);
    expect(names).toContain(PERSONA_BUNDLE_PARTS.memories);
    expect(names).toContain(PERSONA_BUNDLE_PARTS.stickers);
    expect(names).toContain(PERSONA_BUNDLE_PARTS.media);
    expect(manifest.files.length).toBe(2);
    // The write and the read agree on the same bytes.
    expect(readFileSync(path.join(staging, PERSONA_BUNDLE_PARTS.persona), "utf-8")).toContain("小满");
    // Keep the manifest type referenced.
    expect(manifest.kind).toBe("persona");
  });
});
