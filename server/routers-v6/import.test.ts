import { rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { strToU8, zipSync } from "fflate";
import { ENV } from "../_core/env";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.fn();
const getFilesByPersonaId = vi.fn();
const createCollectedMessages = vi.fn();
const countRecords = vi.fn();
const getPersonaFileById = vi.fn();
const updatePersonaFile = vi.fn();
const getUserTimezone = vi.fn();
const getUserById = vi.fn();
const resolveStoredPath = vi.fn();
const readFile = vi.fn();
const deleteRecordsByFile = vi.fn();

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: (...a: unknown[]) => readFile(...a),
}));

vi.mock("../storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveStoredPath: (...a: unknown[]) => resolveStoredPath(...a),
}));

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  createCollectedMessages: (...a: unknown[]) => createCollectedMessages(...a),
  countRecords: (...a: unknown[]) => countRecords(...a),
  getPersonaFileById: (...a: unknown[]) => getPersonaFileById(...a),
  updatePersonaFile: (...a: unknown[]) => updatePersonaFile(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  deleteRecordsByFile: (...a: unknown[]) => deleteRecordsByFile(...a),
  MAX_RECORDS_PER_PERSONA: 1_000_000,
}));

import { appRouter } from "../routers";
import * as importers from "../importers";
import { startImport } from "../importers";
import { importUnpackRelKey } from "../importers/archive";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

const DISK_TEXT = [
  "[2022-03-01 20:00:00] 小满：在吗",
  "[2022-03-01 20:00:05] 阿树：在的",
].join("\n");

/**
 * A zip a test unpacks for real.
 *
 * `unpackZip` writes the entries under the uploads directory, so every
 * test that uploads a zip removes that directory again.
 */
const UNPACK_DIR = path.join(ENV.uploadDir, importUnpackRelKey(1, 5, 11));

function zipOf(files: Record<string, string>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(files)) data[name] = strToU8(body);
  return zipSync(data);
}

async function removeUnpackDir(): Promise<void> {
  await rm(UNPACK_DIR, { recursive: true, force: true });
}

function archiveFile() {
  return {
    id: 11,
    personaId: 5,
    userId: 1,
    fileType: "archive",
    originalName: "chats.zip",
    fileKey: "personas/1/5/chats.zip",
    fileSize: 0,
    parseStatus: null,
    parseReport: null,
  };
}

/** A Telegram takeout with two conversations, so parsing stops at the picker. */
const TELEGRAM_TWO_CHATS = JSON.stringify({
  chats: {
    list: [
      {
        id: "a",
        name: "13800138000",
        messages: [
          {
            id: 1,
            from: "小美",
            date_unixtime: "1646145600",
            date: "2022-03-01T20:00:00",
            text: "打 13800138000",
          },
          {
            id: 2,
            from: "阿树",
            date_unixtime: "1646145605",
            date: "2022-03-01T20:00:05",
            text: "在的",
          },
        ],
      },
      {
        id: "b",
        name: "琪琪",
        messages: [
          {
            id: 3,
            from: "阿树",
            date_unixtime: "1646149200",
            date: "2022-03-01T21:00:00",
            text: "早",
          },
        ],
      },
    ],
  },
});

/** A monologue paragraph that names a third person and carries a number. */
const MONOLOGUE_PARAGRAPH = "今天琪琪打电话过来，号码 13800138000，聊了很久。";
const MONOLOGUE_TEXT = ["2022年3月1日", "", MONOLOGUE_PARAGRAPH].join("\n");

describe("import.backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getFilesByPersonaId.mockResolvedValue([
      {
        id: 11,
        personaId: 5,
        userId: 1,
        fileType: "chat_txt",
        parseStatus: null,
        fileKey: "personas/1/5/old.txt",
        originalName: "old.txt",
        extractedMemory: "this excerpt must not be parsed",
      },
      {
        id: 12,
        personaId: 5,
        userId: 1,
        fileType: "chat_txt",
        parseStatus: "done",
        fileKey: "personas/1/5/done.txt",
        originalName: "done.txt",
      },
      {
        id: 13,
        personaId: 5,
        userId: 1,
        fileType: "image",
        parseStatus: null,
        fileKey: "personas/1/5/pic.png",
        originalName: "pic.png",
      },
    ]);
    getPersonaFileById.mockImplementation(async (id: number) => ({
      id,
      personaId: 5,
      userId: 1,
      fileType: "chat_txt",
      originalName: "old.txt",
      fileKey: "personas/1/5/old.txt",
      fileSize: Buffer.byteLength(DISK_TEXT),
      parseStatus: null,
      parseReport: null,
    }));
    updatePersonaFile.mockResolvedValue(true);
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    countRecords.mockResolvedValue(0);
    createCollectedMessages.mockImplementation(async (rows: unknown[]) => (rows as unknown[]).length);
    resolveStoredPath.mockReturnValue("/tmp/old.txt");
    readFile.mockResolvedValue(Buffer.from(DISK_TEXT, "utf-8"));
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).import.backfill({ personaId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("imports unparsed chat files from disk, not from the truncated excerpt", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).import.backfill({ personaId: 5 });
    expect(result.count).toBe(1);
    expect(result.results).toEqual([{ fileId: 11, status: "needs_roles", written: 0 }]);
    expect(createCollectedMessages).not.toHaveBeenCalled();
    expect(resolveStoredPath).toHaveBeenCalledWith("personas/1/5/old.txt");
    expect(readFile).toHaveBeenCalledWith("/tmp/old.txt");
    expect(readFile).toHaveBeenCalledTimes(1);
    const waiting = updatePersonaFile.mock.calls
      .map((call) => call[2] as { parseStatus?: string; parseReport?: { speakers?: Array<{ name: string }> } })
      .find((patch) => patch.parseStatus === "needs_roles");
    expect(waiting?.parseReport?.speakers?.map((row) => row.name)).toEqual(["小满", "阿树"]);
  });
});

describe("import.status / preview / confirm / cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getPersonaFileById.mockImplementation(async (id: number) => ({
      id,
      personaId: 5,
      userId: 1,
      fileType: "chat_txt",
      originalName: "old.txt",
      fileKey: "personas/1/5/old.txt",
      fileSize: Buffer.byteLength(DISK_TEXT),
      parseStatus: "needs_roles",
      parseReport: { format: "generic-line" },
    }));
    updatePersonaFile.mockResolvedValue(true);
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    countRecords.mockResolvedValue(0);
    createCollectedMessages.mockImplementation(async (rows: unknown[]) => (rows as unknown[]).length);
    deleteRecordsByFile.mockResolvedValue(0);
    resolveStoredPath.mockReturnValue("/tmp/old.txt");
    readFile.mockResolvedValue(Buffer.from(DISK_TEXT, "utf-8"));
  });

  it("does not read somebody else's file", async () => {
    getPersonaFileById.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.import.status({ fileId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.import.preview({ fileId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.import.confirm({ fileId: 99, format: "generic-line", me: ["阿树"], them: ["小满"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.import.cancel({ fileId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns parseStatus without the extracted text", async () => {
    const status = await appRouter.createCaller(ctxFor(1)).import.status({ fileId: 11 });
    expect(status).toMatchObject({
      fileId: 11,
      parseStatus: "needs_roles",
      originalName: "old.txt",
    });
    expect(status).not.toHaveProperty("extractedMemory");
    expect(status).not.toHaveProperty("fileKey");
  });

  it("previews the first records without writing any", async () => {
    updatePersonaFile.mockClear();
    createCollectedMessages.mockClear();
    const preview = await appRouter.createCaller(ctxFor(1)).import.preview({ fileId: 11 });
    expect(preview.status).toBe("ok");
    expect(preview.total).toBe(2);
    expect(preview.records.map((row) => row.speaker)).toEqual(["小满", "阿树"]);
    expect(preview.records.map((row) => row.content)).toEqual(["在吗", "在的"]);
    expect(createCollectedMessages).not.toHaveBeenCalled();
    expect(updatePersonaFile).not.toHaveBeenCalled();
  });

  it("refuses confirm in needs_roles when neither side is named", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).import.confirm({
        fileId: 11,
        format: "generic-line",
        me: [],
        them: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createCollectedMessages).not.toHaveBeenCalled();
  });

  it("does not write on resume when the two sides can be guessed", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).import.resume({
      fileId: 11,
      format: "generic-line",
    });
    expect(result).toMatchObject({ status: "needs_roles", written: 0 });
    expect(createCollectedMessages).not.toHaveBeenCalled();
    expect(deleteRecordsByFile).not.toHaveBeenCalled();
  });

  it("writes records when confirm names both sides", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).import.confirm({
      fileId: 11,
      format: "generic-line",
      me: ["阿树"],
      them: ["小满"],
    });
    expect(result).toMatchObject({ status: "done", written: 2 });
    expect(createCollectedMessages).toHaveBeenCalled();
  });

  it("passes group mode through preview and confirm (C9.8)", async () => {
    const startSpy = vi.spyOn(importers, "startImport");
    const previewSpy = vi.spyOn(importers, "previewImport");
    try {
      const caller = appRouter.createCaller(ctxFor(1));
      await caller.import.preview({
        fileId: 11,
        format: "generic-line",
        me: ["阿树"],
        them: ["小满"],
        mode: "group",
      });
      expect(previewSpy).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 11, mode: "group" }),
      );

      const result = await caller.import.confirm({
        fileId: 11,
        format: "generic-line",
        me: ["阿树"],
        them: ["小满"],
        mode: "group",
      });
      expect(result).toMatchObject({ status: "done", written: 2 });
      expect(startSpy).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 11, mode: "group" }),
      );
      // The mode reached the writer: both rows are group rows, while
      // the roles still name me and TA.
      const rows = createCollectedMessages.mock.calls[0][0] as Array<{
        role: string;
        meta?: { register?: string } | null;
      }>;
      expect(rows.map((row) => row.role)).toEqual(["assistant", "user"]);
      expect(rows.map((row) => row.meta?.register)).toEqual(["group", "group"]);
    } finally {
      startSpy.mockRestore();
      previewSpy.mockRestore();
    }
  });

  it("writes redacted content when confirm asks to hide phones", async () => {
    const withPhone = [
      "[2022-03-01 20:00:00] 小满：打 13800138000",
      "[2022-03-01 20:00:05] 阿树：在的",
    ].join("\n");
    readFile.mockResolvedValue(Buffer.from(withPhone, "utf-8"));
    const result = await appRouter.createCaller(ctxFor(1)).import.confirm({
      fileId: 11,
      format: "generic-line",
      me: ["阿树"],
      them: ["小满"],
      redaction: { phones: true },
    });
    expect(result).toMatchObject({ status: "done", written: 2 });
    const rows = createCollectedMessages.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.content)).toEqual(["打 [phone]", "在的"]);
    expect(JSON.stringify(rows)).not.toContain("13800138000");
    const done = updatePersonaFile.mock.calls
      .map((call) => call[2] as { parseStatus?: string; parseReport?: Record<string, unknown> })
      .find((patch) => patch.parseStatus === "done");
    expect(done?.parseReport?.redaction).toMatchObject({
      phones: true,
      replaced: expect.objectContaining({ phones: 1 }),
    });
    expect(JSON.stringify(done?.parseReport)).not.toContain("13800138000");
    expect(deleteRecordsByFile).toHaveBeenCalledWith(5, 1, 11);
  });

  it("replaces an earlier copy of the same file when confirm redacts it", async () => {
    const withPhone = [
      "[2022-03-01 20:00:00] 小满：打 13800138000",
      "[2022-03-01 20:00:05] 阿树：在的",
    ].join("\n");
    readFile.mockResolvedValue(Buffer.from(withPhone, "utf-8"));
    const caller = appRouter.createCaller(ctxFor(1));
    await caller.import.confirm({
      fileId: 11,
      format: "generic-line",
      me: ["阿树"],
      them: ["小满"],
    });
    createCollectedMessages.mockClear();
    deleteRecordsByFile.mockClear();
    await caller.import.confirm({
      fileId: 11,
      format: "generic-line",
      me: ["阿树"],
      them: ["小满"],
      redaction: { phones: true },
    });
    expect(deleteRecordsByFile).toHaveBeenCalledWith(5, 1, 11);
    const rows = createCollectedMessages.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.content)).toEqual(["打 [phone]", "在的"]);
    expect(JSON.stringify(rows)).not.toContain("13800138000");
  });

  /**
   * The stored report is part of what the user is promised is gone
   * (C1.7).
   *
   * Redaction rewrites the records, but the report kept the first rows of
   * the raw table and the speaker names as they were in the file — and
   * `import.status` sends the whole report back to the browser. So the
   * phone number the user asked to replace was still readable in the
   * database and on the page, next to the sentence that says it cannot
   * be found again.
   */
  describe("the stored parse report after redaction (C1.7)", () => {
    const reports = () =>
      updatePersonaFile.mock.calls
        .map((call) => call[2] as { parseStatus?: string; parseReport?: Record<string, unknown> })
        .map((patch) => patch.parseReport)
        .filter(Boolean);

    it("keeps the raw table without the numbers it replaced", async () => {
      const csv = [
        "time,speaker,content",
        "2022-03-01 20:00:00,小满,打 13800138000",
        "2022-03-01 20:00:05,阿树,在的",
      ].join("\n");
      await startImport({
        fileId: 11,
        userId: 1,
        text: csv,
        format: "column-map",
        columnMap: { time: 0, speaker: 1, content: 2 },
        me: ["阿树"],
        them: ["小满"],
        redaction: { phones: true },
        locale: "zh",
      });
      const stored = reports();
      expect(stored.length).toBeGreaterThan(0);
      for (const report of stored) {
        expect(JSON.stringify(report)).not.toContain("13800138000");
      }
      const withTable = stored.find((report) => report && (report as any).rawTable);
      expect(JSON.stringify((withTable as any)?.rawTable)).toContain("[phone]");
    });

    it("keeps the speaker list without the names it replaced", async () => {
      const text = [
        "[2022-03-01 20:00:00] 琪琪：在吗",
        "[2022-03-01 20:00:05] 阿树：在的",
        "[2022-03-01 20:00:10] 小满：在",
      ].join("\n");
      await startImport({
        fileId: 11,
        userId: 1,
        text,
        format: "generic-line",
        me: ["阿树"],
        them: ["小满"],
        redaction: { names: ["琪琪"] },
        locale: "zh",
      });
      const done = reports().find((report) => report && (report as any).progress === 100);
      expect(done).toBeTruthy();
      expect(JSON.stringify(done)).not.toContain("琪琪");
      expect((done as any).speakers.map((row: { name: string }) => row.name)).toContain("[person-1]");
    });

    /**
     * A zip lists the media files it unpacked (C1.7).
     *
     * Those are names from the person's own phone: a photo called
     * `13800138000.jpg` or a folder named after somebody. The list was
     * written to the report as it was in the archive, so the number the
     * user asked to replace could still be read back with
     * `import.status` — from the same row that says it is gone.
     */
    it("redacts the media file names a zip reports", async () => {
      getPersonaFileById.mockResolvedValue(archiveFile());
      try {
        const result = await startImport({
          fileId: 11,
          userId: 1,
          locale: "zh",
          bytes: zipOf({
            "chat.txt": DISK_TEXT,
            "相册/琪琪_13800138000.jpg": "jpeg-bytes",
          }),
          format: "generic-line",
          me: ["阿树"],
          them: ["小满"],
          redaction: { phones: true, names: ["琪琪"] },
        });
        expect(result).toMatchObject({ status: "done", written: 2 });
        const done = reports().find((report) => report && (report as any).progress === 100);
        expect(done).toBeTruthy();
        const serialized = JSON.stringify(done);
        expect(serialized).not.toContain("13800138000");
        expect(serialized).not.toContain("琪琪");
        const media = ((done as any).mediaFiles as string[]).join(" ");
        expect(media).toContain("[phone]");
        expect(media).toContain("[person-1]");
      } finally {
        await removeUnpackDir();
      }
    });

    /**
     * The zip paths are written before the parse has a report to redact
     * (C1.7).
     *
     * A zip that stops at the chat picker stores its chat file names,
     * its media file names, and its listed conversations immediately.
     * Those came straight out of the archive, so a file called after a
     * phone number was in the database before any redaction option was
     * ever built.
     */
    it("redacts the archive report written when a zip stops at needs_chat", async () => {
      getPersonaFileById.mockResolvedValue(archiveFile());
      try {
        const result = await startImport({
          fileId: 11,
          userId: 1,
          locale: "zh",
          bytes: zipOf({
            "chat-13800138000.txt": DISK_TEXT,
            "chat-琪琪.txt": DISK_TEXT,
            "相册/琪琪_13800138000.jpg": "jpeg-bytes",
          }),
          redaction: { phones: true, names: ["琪琪"] },
        });
        expect(result).toMatchObject({ status: "needs_chat", written: 0 });
        const waitingPatch = updatePersonaFile.mock.calls
          .map((call) => call[2] as { parseStatus?: string; parseReport?: Record<string, unknown> })
          .find((patch) => patch.parseStatus === "needs_chat");
        expect(waitingPatch).toBeTruthy();
        const stored = waitingPatch!.parseReport!;
        const serialized = JSON.stringify(stored);
        expect(serialized).not.toContain("13800138000");
        expect(serialized).not.toContain("琪琪");
        expect(serialized).toContain("[phone]");
        expect(serialized).toContain("[person-1]");
      } finally {
        await removeUnpackDir();
      }
    });

    it("redacts the archive report written when a zip holds no chat file", async () => {
      getPersonaFileById.mockResolvedValue(archiveFile());
      try {
        const result = await startImport({
          fileId: 11,
          userId: 1,
          locale: "zh",
          bytes: zipOf({
            "相册/琪琪_13800138000.jpg": "jpeg-bytes",
            "notes-13800138000.exe": "MZ",
          }),
          redaction: { phones: true, names: ["琪琪"] },
        });
        expect(result).toMatchObject({ status: "needs_format", written: 0 });
        const waitingPatch = updatePersonaFile.mock.calls
          .map((call) => call[2] as { parseStatus?: string; parseReport?: Record<string, unknown> })
          .find((patch) => patch.parseStatus === "needs_format");
        expect(waitingPatch).toBeTruthy();
        const serialized = JSON.stringify(waitingPatch!.parseReport);
        expect(serialized).not.toContain("13800138000");
        expect(serialized).not.toContain("琪琪");
        expect(serialized).toContain("[phone]");
      } finally {
        await removeUnpackDir();
      }
    });

    /**
     * The redacted picker must still pick (C1.7).
     *
     * The id the stored report offers is `chat-N` now instead of the
     * archive path, so the resume has to translate it back to the entry
     * that was unpacked. A path a caller kept from before redaction
     * still works too.
     */
    it("resumes a redacted zip from the picker id it stored", async () => {
      getPersonaFileById.mockResolvedValue(archiveFile());
      const files = {
        "chat-13800138000.txt": DISK_TEXT,
        "chat-琪琪.txt": DISK_TEXT,
      };
      try {
        const first = await startImport({
          fileId: 11,
          userId: 1,
          locale: "zh",
          bytes: zipOf(files),
          redaction: { phones: true, names: ["琪琪"] },
        });
        expect(first).toMatchObject({ status: "needs_chat", written: 0 });
        const stored = updatePersonaFile.mock.calls
          .map((call) => call[2] as { parseStatus?: string; parseReport?: Record<string, any> })
          .find((patch) => patch.parseStatus === "needs_chat")!.parseReport!;
        const ids = (stored.chats as Array<{ id: string }>).map((chat) => chat.id);
        expect(new Set(ids)).toEqual(new Set(["chat-1", "chat-2"]));

        const byRedactedId = await startImport({
          fileId: 11,
          userId: 1,
          locale: "zh",
          bytes: zipOf(files),
          chatId: ids[1],
          me: ["阿树"],
          them: ["小满"],
          redaction: { phones: true, names: ["琪琪"] },
        });
        expect(byRedactedId.status).toBe("done");

        // A caller that kept the archive path sees the same file.
        const byPath = await startImport({
          fileId: 11,
          userId: 1,
          locale: "zh",
          bytes: zipOf(files),
          chatId: "chat-琪琪.txt",
          me: ["阿树"],
          them: ["小满"],
          redaction: { phones: true, names: ["琪琪"] },
        });
        expect(byPath.status).toBe("done");
      } finally {
        await removeUnpackDir();
      }
    });
  });

  /**
   * Resuming an import continues the same job (C1.7).
   *
   * `confirm` is the call that carries the redaction switches, but the
   * server may stop it at the chat picker or at the role pause. The
   * resume call re-parses the file and writes the report again — and a
   * resumed monologue writes rows — so the switches have to travel with
   * it. A resume without them keeps the previous behaviour: nothing is
   * replaced. Callers are responsible for passing what the user ticked.
   */
  describe("resuming an import with redaction (C1.7)", () => {
    const patchReports = () =>
      updatePersonaFile.mock.calls
        .map((call) => call[2] as { parseStatus?: string; parseReport?: Record<string, unknown> })
        .filter((patch) => Boolean(patch.parseReport));

    it("re-redacts the report when a paused import is resumed with the switches", async () => {
      readFile.mockResolvedValue(Buffer.from(TELEGRAM_TWO_CHATS, "utf-8"));
      // A user of its own: the upload procedures are rate limited per
      // user, and this file already calls them a lot.
      const caller = appRouter.createCaller(ctxFor(21));
      const paused = await caller.import.confirm({
        fileId: 11,
        format: "telegram-json",
        me: ["阿树"],
        them: ["小满"],
        redaction: { phones: true, names: ["小美"] },
      });
      expect(paused).toMatchObject({ status: "needs_chat", written: 0 });

      updatePersonaFile.mockClear();
      const resumed = await caller.import.resume({
        fileId: 11,
        format: "telegram-json",
        chatId: "a",
        redaction: { phones: true, names: ["小美"] },
      });
      expect(resumed).toMatchObject({ status: "needs_roles", written: 0 });
      const waiting = patchReports().find((patch) => patch.parseStatus === "needs_roles");
      expect(waiting).toBeTruthy();
      const serialized = JSON.stringify(waiting!.parseReport);
      expect(serialized).not.toContain("13800138000");
      expect(serialized).not.toContain("小美");
      expect(serialized).toContain("[phone]");
      expect(serialized).toContain("[person-1]");
    });

    it("does not redact a resume that carries no switches, as before", async () => {
      readFile.mockResolvedValue(Buffer.from(TELEGRAM_TWO_CHATS, "utf-8"));
      const caller = appRouter.createCaller(ctxFor(22));
      const paused = await caller.import.confirm({
        fileId: 11,
        format: "telegram-json",
        me: ["阿树"],
        them: ["小满"],
        redaction: { phones: true, names: ["小美"] },
      });
      expect(paused).toMatchObject({ status: "needs_chat" });

      updatePersonaFile.mockClear();
      const resumed = await caller.import.resume({
        fileId: 11,
        format: "telegram-json",
        chatId: "a",
      });
      expect(resumed).toMatchObject({ status: "needs_roles" });
      const waiting = patchReports().find((patch) => patch.parseStatus === "needs_roles");
      expect(waiting).toBeTruthy();
      // The switches are the caller's job. Omitting them is the old
      // request, and it still leaves the report as it was parsed.
      expect(JSON.stringify(waiting!.parseReport)).toContain("13800138000");
    });

    it("writes a resumed monologue with the switches it is given", async () => {
      readFile.mockResolvedValue(Buffer.from(MONOLOGUE_TEXT, "utf-8"));
      const resumed = await appRouter.createCaller(ctxFor(23)).import.resume({
        fileId: 11,
        format: "monologue",
        redaction: { phones: true, names: ["琪琪"] },
      });
      expect(resumed).toMatchObject({ status: "done", written: 1 });
      const rows = createCollectedMessages.mock.calls[0][0] as Array<{ content: string }>;
      expect(rows.map((row) => row.content)).toEqual([
        "今天[person-1]打电话过来，号码 [phone]，聊了很久。",
      ]);
      expect(JSON.stringify(rows)).not.toContain("13800138000");
      const done = patchReports().find((patch) => (patch.parseReport as any)?.progress === 100);
      expect(done).toBeTruthy();
      expect(JSON.stringify(done!.parseReport)).not.toContain("13800138000");
      expect(JSON.stringify(done!.parseReport)).not.toContain("琪琪");
      expect((done!.parseReport as any).redaction).toMatchObject({
        phones: true,
        replaced: expect.objectContaining({ phones: 1, names: 1 }),
      });
    });

    it("writes a resumed monologue unchanged when no switches are given", async () => {
      readFile.mockResolvedValue(Buffer.from(MONOLOGUE_TEXT, "utf-8"));
      const resumed = await appRouter.createCaller(ctxFor(24)).import.resume({
        fileId: 11,
        format: "monologue",
      });
      expect(resumed).toMatchObject({ status: "done", written: 1 });
      const rows = createCollectedMessages.mock.calls[0][0] as Array<{ content: string }>;
      expect(rows.map((row) => row.content)).toEqual([MONOLOGUE_PARAGRAPH]);
    });
  });

  it("marks a cancelled import as failed", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).import.cancel({ fileId: 11 });
    expect(result).toEqual({ status: "failed" });
    expect(updatePersonaFile).toHaveBeenCalledWith(
      11,
      1,
      expect.objectContaining({ parseStatus: "failed" }),
    );
  });

  it("lists registered formats for the wizard", async () => {
    const formats = await appRouter.createCaller(ctxFor(1)).import.formats();
    const ids = formats.map((row) => row.id) as string[];
    expect(ids).toContain("generic-line");
    expect(ids).not.toContain("wechat-html");
    expect(formats[0]).toHaveProperty("label");
  });
});
