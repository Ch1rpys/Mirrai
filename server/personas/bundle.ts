/**
 * Building a `.mirrai-persona` file out of one persona, and putting one
 * back (C9.5).
 *
 * The file is the backup container with a persona-shaped manifest; see
 * `server/_core/bundle.ts` for the format. This module is the part that
 * knows the tables.
 *
 * Two rules the import keeps whatever the file says:
 *
 *   - **It is always a new persona.** Every id is new: the records are
 *     re-inserted and their old ids are mapped to the new ones, and every
 *     reference stored as an id — a memory's source line, a piece of
 *     evidence in the portrait, a kept quote, a reply — is rewritten
 *     through the same map. Without records in the bundle those ids are
 *     set to null rather than left pointing at another install's rows.
 *   - **Nothing half-made survives a failure.** A bundle that fails part
 *     way through takes the persona it created and the files it wrote
 *     with it.
 */
import { createReadStream, promises as fs, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import * as db from "../db";
import { ENV } from "../_core/env";
import { resolveUploadPath } from "../_core/filename";
import { resolveStoredPath } from "../storage";
import {
  extractPersonaBundle,
  PERSONA_BUNDLE_EXTENSION,
  PERSONA_BUNDLE_FORMAT,
  PERSONA_BUNDLE_PARTS,
  safeBundleFileName,
  writePersonaBundle,
  type PersonaBundleManifest,
  type PersonaBundleEntry,
  type WrittenPersonaBundle,
} from "../_core/bundle";
import { measureStyleProfile } from "../_core/style-profile";

export interface BundleInclude {
  memories: boolean;
  records: boolean;
  conversation: boolean;
}

export interface ExportPersonaBundleOptions {
  personaId: number;
  userId: number;
  include: BundleInclude;
  /** A passphrase encrypts the file; null writes a plain zip. */
  passphrase?: string | null;
  /** Where the file is written. The route streams it afterwards. */
  outPath: string;
  now?: Date;
}

/** A settings key that describes this machine rather than the persona. */
const LOCAL_SETTINGS = new Set([
  // The per-persona lock needs a PIN that exists on this install.
  "locked",
  // A consent link token hash was minted here and expires.
  "consentLink",
  // Distillation state of this install.
  "pendingRedistillAdded",
  "pendingRedistillRemoved",
  "saidItHintShown",
  // LLM provider names configured on this machine.
  "providers",
]);

/** The persona row, as the bundle stores it. */
export interface BundlePersona {
  name: string;
  relationshipDesc: string | null;
  togetherFrom: string | null;
  togetherTo: string | null;
  timezone: string | null;
  characterFamily: string | null;
  personaData: unknown;
  settings: Record<string, unknown>;
}

const personaSchema = z.object({
  name: z.string().min(1).max(100),
  relationshipDesc: z.string().nullish(),
  togetherFrom: z.string().nullish(),
  togetherTo: z.string().nullish(),
  timezone: z.string().nullish(),
  characterFamily: z.string().nullish(),
  personaData: z.unknown(),
  settings: z.record(z.string(), z.unknown()),
});

function sanitizedSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of LOCAL_SETTINGS) delete out[key];
  return out;
}

/** One NDJSON part: an async iterable of UTF-8 lines. */
async function* ndjson(rows: unknown[]): AsyncIterable<Uint8Array> {
  for (const row of rows) {
    yield Buffer.from(`${JSON.stringify(row)}\n`, "utf-8");
  }
}

async function readNdjson(dir: string, file: string): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, file), "utf-8");
  } catch {
    return [];
  }
  const rows: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      throw new Error(`The bundle's ${file} is not valid NDJSON.`);
    }
  }
  return rows;
}

/** A file entry, read from the uploads directory. */
function fileEntry(absPath: string, name: string): PersonaBundleEntry {
  return {
    name,
    compress: false,
    chunks: () => createReadStream(absPath) as unknown as AsyncIterable<Uint8Array>,
  };
}

/** The relative file key a bundle file is imported to. */
export function importedRelKey(
  userId: number,
  personaId: number,
  kind: "stickers" | "media",
  fileName: string,
): string {
  return `personas/${userId}/${personaId}/bundle-${kind}/${safeBundleFileName(fileName, "file")}`;
}

/**
 * Writes one persona into a `.mirrai-persona` file.
 *
 * The records are exported in id order; the import relies on that to pair
 * old rows with new ones.
 */
export async function exportPersonaBundle(
  options: ExportPersonaBundleOptions,
): Promise<WrittenPersonaBundle & { fileName: string }> {
  const { personaId, userId, include } = options;
  const now = options.now ?? new Date();
  const persona = await db.getPersonaById(personaId, userId);
  if (!persona) throw new Error("Persona not found");

  const records = include.records ? await db.listRecordsForBundle(personaId, userId) : [];
  const memories = include.memories
    ? await db.getMemoriesByPersonaId(personaId, userId, 100_000)
    : [];
  const messages = include.conversation
    ? await db.getMessagesByPersonaIdPaged(personaId, userId, { pageSize: 1000, max: 20_000 })
    : [];
  const stickers = await db.listStickers(personaId, userId);
  const wantsMedia = include.records || include.memories;
  const media = wantsMedia ? await db.listMedia(personaId, userId) : [];
  const memoryLinks = include.memories
    ? await db.listMemoryMediaForMemories(memories.map((memory) => memory.id), userId)
    : [];

  const entries: PersonaBundleEntry[] = [];
  const recordRows = records.map((row, index) => {
    const meta = row.meta && typeof row.meta === "object"
      ? { ...(row.meta as Record<string, unknown>) }
      : null;
    // The attachment path points inside the source install's unpack
    // directory; the bytes that matter live in the media table.
    if (meta) delete meta.path;
    return {
      index,
      oldId: row.id,
      kind: row.kind,
      role: row.role,
      speaker: row.speaker ?? null,
      content: row.content,
      timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null,
      lineNo: row.lineNo ?? null,
      meta,
    };
  });
  const memoryRows = memories.map((memory, index) => ({
    index,
    oldId: memory.id,
    oldRecordId: memory.recordId ?? null,
    title: memory.title,
    description: memory.description ?? null,
    category: memory.category,
    date: memory.date ?? null,
    importance: memory.importance,
    isPinned: memory.isPinned,
    factKey: memory.factKey ?? null,
    status: memory.status,
    subject: memory.subject,
    source: memory.source,
    mentionCount: memory.mentionCount,
    entities: memory.entities ?? null,
  }));
  const messageRows = messages.map((message) => ({
    oldId: message.id,
    oldReplyToId: message.replyToId ?? null,
    role: message.role,
    content: message.content,
    messageType: message.messageType,
    mediaUrl: message.mediaUrl ?? null,
    mediaDuration: message.mediaDuration ?? null,
    emotionalState: message.emotionalState ?? null,
    channel: message.channel,
    origin: message.origin ?? null,
    metadata: message.metadata ?? null,
    createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : null,
  }));
  const mediaRows: Array<Record<string, unknown>> = [];
  for (const [index, row] of media.entries()) {
    const disk = resolveStoredPath(row.fileKey);
    const name = `files/media/${index}-${safeBundleFileName(row.fileKey, "media")}`;
    if (disk) entries.push(fileEntry(disk, name));
    mediaRows.push({
      index,
      oldId: row.id,
      oldRecordId: row.recordId ?? null,
      kind: row.kind,
      fileName: disk ? name.slice("files/media/".length) : null,
      mime: row.mime ?? null,
      bytes: row.bytes ?? null,
      hash: row.hash,
      at: row.at ? new Date(row.at).toISOString() : null,
      fromThem: row.fromThem,
      durationSec: row.durationSec ?? null,
      width: row.width ?? null,
      height: row.height ?? null,
      transcript: row.transcript ?? null,
      transcriptEngine: row.transcriptEngine ?? null,
      exif: row.exif ?? null,
    });
  }
  const stickerRows: Array<Record<string, unknown>> = [];
  for (const [index, row] of stickers.entries()) {
    const disk = row.fileKey ? resolveStoredPath(row.fileKey) : null;
    const name = `files/stickers/${index}-${safeBundleFileName(row.fileKey ?? row.key, "sticker")}`;
    if (disk) entries.push(fileEntry(disk, name));
    stickerRows.push({
      index,
      key: row.key,
      label: row.label,
      fileName: disk ? name.slice("files/stickers/".length) : null,
      mime: row.mime ?? null,
      usesByThem: row.usesByThem,
      usesByMe: row.usesByMe,
      firstUsedAt: row.firstUsedAt ? new Date(row.firstUsedAt).toISOString() : null,
      lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
      enabled: row.enabled,
    });
  }
  const linkRows = memoryLinks.map((link) => ({
    memoryIndex: memories.findIndex((memory) => memory.id === link.memoryId),
    mediaIndex: media.findIndex((row) => row.id === link.mediaId),
  }));

  const bundlePersona: BundlePersona = {
    name: persona.name,
    relationshipDesc: (persona as { relationshipDesc?: string | null }).relationshipDesc ?? null,
    togetherFrom: (persona as { togetherFrom?: string | null }).togetherFrom ?? null,
    togetherTo: (persona as { togetherTo?: string | null }).togetherTo ?? null,
    timezone: (persona as { timezone?: string | null }).timezone ?? null,
    characterFamily: (persona as { characterFamily?: string | null }).characterFamily ?? null,
    personaData: persona.personaData ?? {},
    settings: sanitizedSettings((persona as { settings?: unknown }).settings),
  };

  // The JSON parts first, then the binary files: a reader that streams the
  // archive sees the description before the bytes it describes.
  const textEntries: PersonaBundleEntry[] = [
    {
      name: PERSONA_BUNDLE_PARTS.persona,
      compress: true,
      chunks: async function* () {
        yield Buffer.from(JSON.stringify(bundlePersona, null, 2), "utf-8");
      },
    },
    {
      name: PERSONA_BUNDLE_PARTS.stickers,
      compress: true,
      chunks: () => ndjson(stickerRows),
    },
  ];
  if (include.records) {
    textEntries.push({ name: PERSONA_BUNDLE_PARTS.records, compress: true, chunks: () => ndjson(recordRows) });
  }
  if (include.memories) {
    textEntries.push({ name: PERSONA_BUNDLE_PARTS.memories, compress: true, chunks: () => ndjson(memoryRows) });
    textEntries.push({ name: PERSONA_BUNDLE_PARTS.memoryMedia, compress: true, chunks: () => ndjson(linkRows) });
  }
  if (include.conversation) {
    textEntries.push({ name: PERSONA_BUNDLE_PARTS.messages, compress: true, chunks: () => ndjson(messageRows) });
  }
  if (wantsMedia) {
    textEntries.push({ name: PERSONA_BUNDLE_PARTS.media, compress: true, chunks: () => ndjson(mediaRows) });
  }

  const written = await writePersonaBundle({
    outPath: options.outPath,
    entries: [...textEntries, ...entries],
    passphrase: options.passphrase ?? null,
    manifest: {
      kind: "persona",
      format: PERSONA_BUNDLE_FORMAT,
      createdAt: now.toISOString(),
      appVersion: process.env.npm_package_version ?? "1.3.0",
      source: { personaId, name: persona.name },
      includes: include,
      counts: {
        records: recordRows.length,
        memories: memoryRows.length,
        messages: messageRows.length,
        stickers: stickerRows.length,
        media: mediaRows.length,
      },
    },
  });
  const fileName = `${safeBundleFileName(persona.name, "persona")}${PERSONA_BUNDLE_EXTENSION}`;
  return { ...written, fileName };
}

/** What an import produced, for the caller's sentence. */
export interface ImportedPersonaBundle {
  personaId: number;
  name: string;
  counts: PersonaBundleManifest["counts"];
}

/**
 * Replaces every `recordId` (and arrays named `recordIds`) in a stored
 * object with the imported row's id.
 *
 * With records in the bundle, an id that was not in the bundle cannot be
 * resolved and becomes null. Without records, every id becomes null and
 * only the text the evidence was made of stays.
 */
function remapRecordIds(value: unknown, map: Map<number, number>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapRecordIds(item, map));
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "recordId") {
      const id = typeof item === "number" ? map.get(item) ?? null : null;
      out[key] = id;
      continue;
    }
    if (key === "recordIds" && Array.isArray(item)) {
      out[key] = item.flatMap((entry) => {
        const id = typeof entry === "number" ? map.get(entry) : undefined;
        return id == null ? [] : [id];
      });
      continue;
    }
    out[key] = remapRecordIds(item, map);
  }
  return out;
}

/**
 * Puts a bundle back as a **new** persona.
 *
 * Everything is written as the importing user; the id maps are built as
 * the rows are inserted, and every stored reference is rewritten through
 * them. A failure removes the persona and the files.
 */
export async function importPersonaBundle(options: {
  userId: number;
  filePath: string;
  passphrase?: string | null;
  now?: Date;
}): Promise<ImportedPersonaBundle> {
  const { userId, filePath } = options;
  const stagingDir = mkdtempSync(path.join(os.tmpdir(), "mirrai-bundle-"));
  let personaId: number | null = null;
  const writtenFiles: string[] = [];
  try {
    const { manifest } = await extractPersonaBundle({
      filePath,
      passphrase: options.passphrase ?? null,
      stagingDir,
    });
    const rawPersona = await fs.readFile(path.join(stagingDir, PERSONA_BUNDLE_PARTS.persona), "utf-8");
    const parsedPersona = personaSchema.safeParse(JSON.parse(rawPersona));
    if (!parsedPersona.success) {
      throw new Error("The bundle's persona.json is not a persona this version can read.");
    }
    const persona = parsedPersona.data;

    personaId = await db.createPersona({
      userId,
      name: persona.name,
      relationshipDesc: persona.relationshipDesc ?? null,
      togetherFrom: persona.togetherFrom ?? null,
      togetherTo: persona.togetherTo ?? null,
      timezone: persona.timezone ?? null,
      characterFamily: persona.characterFamily as never,
      // The portrait is filled in below, once the records it cites have
      // their new ids.
      personaData: {},
      settings: sanitizedSettings(persona.settings) as never,
      analysisStatus: "ready",
    } as never);

    const recordMap = new Map<number, number>();
    if (manifest.includes.records) {
      const rows = await readNdjson(stagingDir, PERSONA_BUNDLE_PARTS.records);
      const inserts = rows.map((row) => {
        const data = row as Record<string, unknown>;
        return {
          userId,
          personaId: personaId!,
          source: "bundle",
          role: String(data.role ?? "user"),
          content: String(data.content ?? ""),
          timestamp: data.timestamp ? new Date(String(data.timestamp)) : null,
          kind: String(data.kind ?? "text"),
          speaker: typeof data.speaker === "string" ? data.speaker : null,
          fileId: null,
          lineNo: typeof data.lineNo === "number" ? data.lineNo : null,
          meta: data.meta ?? null,
        };
      });
      await db.createCollectedMessages(inserts as never);
      const ids = await db.listCollectedRecordIds(personaId, userId);
      if (ids.length !== rows.length) {
        throw new Error("The bundle's records could not all be written.");
      }
      rows.forEach((row, index) => {
        const oldId = (row as Record<string, unknown>).oldId;
        if (typeof oldId === "number") recordMap.set(oldId, ids[index]);
      });
    }

    // Media: the bytes and the rows. The person's file keys are rewritten
    // so nothing points back into the source install.
    const mediaMap = new Map<number, number>();
    if (manifest.includes.records || manifest.includes.memories) {
      const rows = await readNdjson(stagingDir, PERSONA_BUNDLE_PARTS.media);
      for (const row of rows) {
        const data = row as Record<string, unknown>;
        let fileKey: string | null = null;
        if (typeof data.fileName === "string") {
          const source = path.join(stagingDir, "files/media", safeBundleFileName(data.fileName, "media"));
          fileKey = importedRelKey(userId, personaId, "media", String(data.fileName));
          const target = resolveUploadPath(ENV.uploadDir, fileKey);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(source, target);
          writtenFiles.push(fileKey);
        }
        if (!fileKey) continue;
        const inserted = await db.upsertMedia({
          userId,
          personaId: personaId!,
          kind: String(data.kind ?? "photo"),
          fileKey,
          mime: typeof data.mime === "string" ? data.mime : null,
          bytes: typeof data.bytes === "number" ? data.bytes : null,
          hash: String(data.hash ?? ""),
          at: data.at ? new Date(String(data.at)) : null,
          recordId: typeof data.oldRecordId === "number" ? recordMap.get(data.oldRecordId) ?? null : null,
          fileId: null,
          fromThem: Boolean(data.fromThem),
          durationSec: typeof data.durationSec === "number" ? data.durationSec : null,
          width: typeof data.width === "number" ? data.width : null,
          height: typeof data.height === "number" ? data.height : null,
          transcript: typeof data.transcript === "string" ? data.transcript : null,
          transcriptEngine: typeof data.transcriptEngine === "string" ? data.transcriptEngine : null,
          exif: data.exif ?? null,
        });
        if (typeof data.oldId === "number") mediaMap.set(data.oldId, inserted.id);
      }
    }

    const memoryMap = new Map<number, number>();
    if (manifest.includes.memories) {
      const rows = await readNdjson(stagingDir, PERSONA_BUNDLE_PARTS.memories);
      for (const row of rows) {
        const data = row as Record<string, unknown>;
        const created = await db.createMemory({
          userId,
          personaId: personaId!,
          title: String(data.title ?? ""),
          description: typeof data.description === "string" ? data.description : null,
          category: String(data.category ?? "memory") as never,
          date: typeof data.date === "string" ? data.date : null,
          messageId: null,
          importance: typeof data.importance === "number" ? data.importance : 1,
          isPinned: Boolean(data.isPinned),
          factKey: typeof data.factKey === "string" ? data.factKey : null,
          status: String(data.status ?? "active"),
          subject: String(data.subject ?? "them") as never,
          source: String(data.source ?? "chat"),
          mentionCount: typeof data.mentionCount === "number" ? data.mentionCount : 0,
          entities: data.entities ?? null,
          recordId: typeof data.oldRecordId === "number" ? recordMap.get(data.oldRecordId) ?? null : null,
        } as never);
        if (typeof data.oldId === "number") memoryMap.set(data.oldId, created);
      }
      for (const row of await readNdjson(stagingDir, PERSONA_BUNDLE_PARTS.memoryMedia)) {
        const data = row as Record<string, unknown>;
        const memoryIndex = typeof data.memoryIndex === "number" ? data.memoryIndex : -1;
        const mediaIndex = typeof data.mediaIndex === "number" ? data.mediaIndex : -1;
        const oldMemoryId = rows[memoryIndex] && (rows[memoryIndex] as Record<string, unknown>).oldId;
        const oldMediaId = mediaRowsLookup(await readNdjson(stagingDir, PERSONA_BUNDLE_PARTS.media), mediaIndex);
        if (typeof oldMemoryId !== "number" || oldMediaId == null) continue;
        const memoryId = memoryMap.get(oldMemoryId);
        const mediaId = mediaMap.get(oldMediaId);
        if (!memoryId || !mediaId) continue;
        await db.linkMemoryMedia({ userId, personaId: personaId!, memoryId, mediaId });
      }
    }

    if (manifest.includes.conversation) {
      const rows = await readNdjson(stagingDir, PERSONA_BUNDLE_PARTS.messages);
      const messageMap = new Map<number, number>();
      for (const row of rows) {
        const data = row as Record<string, unknown>;
        const oldId = typeof data.oldId === "number" ? data.oldId : null;
        const oldReplyTo = typeof data.oldReplyToId === "number" ? data.oldReplyToId : null;
        const id = await db.createMessage({
          userId,
          personaId: personaId!,
          role: String(data.role ?? "assistant") as never,
          content: String(data.content ?? ""),
          messageType: (data.messageType ?? "text") as never,
          mediaUrl: typeof data.mediaUrl === "string" ? data.mediaUrl : null,
          mediaDuration: typeof data.mediaDuration === "number" ? data.mediaDuration : null,
          emotionalState: typeof data.emotionalState === "string" ? data.emotionalState : null,
          channel: (data.channel ?? "web") as never,
          origin: typeof data.origin === "string" ? data.origin : null,
          metadata: remapRecordIds(data.metadata ?? null, recordMap),
          createdAt: data.createdAt ? new Date(String(data.createdAt)) : undefined,
          replyToId: oldReplyTo != null ? messageMap.get(oldReplyTo) ?? null : null,
        } as never);
        if (oldId != null) messageMap.set(oldId, id);
      }
    }

    // The sticker library: rows and bytes.
    for (const row of await readNdjson(stagingDir, PERSONA_BUNDLE_PARTS.stickers)) {
      const data = row as Record<string, unknown>;
      let fileKey: string | null = null;
      if (typeof data.fileName === "string") {
        const source = path.join(stagingDir, "files/stickers", safeBundleFileName(data.fileName, "sticker"));
        fileKey = importedRelKey(userId, personaId, "stickers", String(data.fileName));
        const target = resolveUploadPath(ENV.uploadDir, fileKey);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
        writtenFiles.push(fileKey);
      }
      await db.upsertSticker({
        userId,
        personaId: personaId!,
        key: String(data.key ?? ""),
        label: String(data.label ?? ""),
        fileKey,
        mime: typeof data.mime === "string" ? data.mime : null,
        usesByThem: typeof data.usesByThem === "number" ? data.usesByThem : 0,
        usesByMe: typeof data.usesByMe === "number" ? data.usesByMe : 0,
        firstUsedAt: data.firstUsedAt ? new Date(String(data.firstUsedAt)) : null,
        lastUsedAt: data.lastUsedAt ? new Date(String(data.lastUsedAt)) : null,
        enabled: data.enabled !== false,
      });
    }

    /**
     * The portrait, after the records: its evidence points at lines that
     * now have new ids. A quote the user kept in the settings is rewritten
     * the same way.
     */
    const personaData = remapRecordIds(persona.personaData ?? {}, recordMap);
    const settings = sanitizedSettings(persona.settings);
    if (Array.isArray(settings.keptQuotes)) {
      settings.keptQuotes = (settings.keptQuotes as Array<Record<string, unknown>>).flatMap((quote) => {
        if (!quote || typeof quote !== "object") return [];
        const oldId = typeof quote.recordId === "number" ? quote.recordId : null;
        if (oldId == null) return [quote];
        const mapped = recordMap.get(oldId) ?? null;
        return [{ ...quote, recordId: mapped }];
      });
    }
    if (!manifest.includes.records) {
      // Without the lines the ids cannot mean anything here.
      for (const quote of (settings.keptQuotes as Array<Record<string, unknown>> | undefined) ?? []) {
        if (quote && typeof quote === "object") quote.recordId = null;
      }
    }
    await db.updatePersona(personaId, userId, {
      personaData: personaData as never,
      settings: settings as never,
    });

    // The style profile is measured here rather than carried in the file:
    // the bundle never contains one. With no records there is nothing to
    // measure, and the measurement returns without inventing anything.
    await measureStyleProfile({ personaId, userId, force: true }).catch((error: unknown) => {
      console.warn("[Bundle] The imported persona could not be measured:", error);
    });

    return {
      personaId,
      name: persona.name,
      counts: manifest.counts,
    };
  } catch (error) {
    if (personaId != null) {
      await db.purgePersona(personaId, userId).catch(() => undefined);
    }
    for (const key of writtenFiles) {
      const abs = resolveStoredPath(key);
      if (abs) await fs.rm(abs, { force: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

/** The bundle index of a media row, from the NDJSON the link list names. */
function mediaRowsLookup(rows: unknown[], index: number): number | null {
  const row = rows[index] as Record<string, unknown> | undefined;
  return row && typeof row.oldId === "number" ? row.oldId : null;
}
