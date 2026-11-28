import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { importUnpackRelKey } from "./archive";

/**
 * What a redacted import may still keep (C1.7).
 *
 * The wizard promises that a replaced number cannot be found again. The
 * records were already redacted, but the same text can live outside
 * `content`: a voice note's transcript sits in `meta.transcript`, and a
 * phone names its photos after the people and numbers in them
 * (`IMG_13800138000.jpg` is what the export calls the file, and the
 * record's `meta.path` kept that name). The media row copies the
 * transcript again into `media.transcript`, so the check has to follow
 * the value all the way there.
 *
 * These tests run the real `startImport`, the real importers (a real
 * WeChat CSV and a real WhatsApp TXT inside a real zip), the real
 * `redactRecords` and the real `registerMedia`. Only the database is
 * mocked, and the file system is real: the zip is unpacked into the
 * uploads directory the import writes to.
 */
const getPersonaFileById = vi.hoisted(() => vi.fn());
const getPersonaById = vi.hoisted(() => vi.fn());
const getUserById = vi.hoisted(() => vi.fn());
const getUserTimezone = vi.hoisted(() => vi.fn());
const updatePersonaFile = vi.hoisted(() => vi.fn());
const deleteRecordsByFile = vi.hoisted(() => vi.fn());
const importRecords = vi.hoisted(() => vi.fn());
const afterRecordsChanged = vi.hoisted(() => vi.fn());
const iterateRecords = vi.hoisted(() => vi.fn());
const upsertMedia = vi.hoisted(() => vi.fn());
const listStickers = vi.hoisted(() => vi.fn());
const upsertSticker = vi.hoisted(() => vi.fn());
const countStickers = vi.hoisted(() => vi.fn());
/** The rows `importRecords` said it wrote, in the shape `iterateRecords` returns. */
const stored = vi.hoisted(() => ({ rows: [] as Array<Record<string, any>> }));

vi.mock("../db", () => ({
  getPersonaFileById,
  getPersonaById,
  getUserById,
  getUserTimezone,
  updatePersonaFile,
  deleteRecordsByFile,
  iterateRecords,
  upsertMedia,
  listStickers,
  upsertSticker,
  countStickers,
}));

vi.mock("../collectors/db-store", () => ({
  importRecords,
  RecordLimitError: class RecordLimitError extends Error {
    current = 0;
    incoming = 0;
    max = 0;
  },
}));

vi.mock("../_core/style-profile", () => ({ afterRecordsChanged }));

import { registerMedia } from "./media";
import { startImport } from "./index";
import { registerStickers } from "./stickers";

const FILE_ID = 11;
const PERSONA_ID = 5;
const USER_ID = 1;

function file(fileType = "chat_txt", originalName = "wechat.csv") {
  return {
    id: FILE_ID,
    userId: USER_ID,
    personaId: PERSONA_ID,
    fileType,
    originalName,
    fileKey: `personas/1/5/${originalName}`,
    fileUrl: `/uploads/${originalName}`,
    fileSize: 0,
    processStatus: "done",
    parseStatus: "needs_roles",
    parseReport: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function writtenRows(): Array<Record<string, any>> {
  return (importRecords.mock.calls.at(-1)?.[0] as { records: Array<Record<string, any>> } | undefined)
    ?.records ?? [];
}

function reports(): Array<Record<string, any>> {
  return updatePersonaFile.mock.calls
    .map((call) => (call[2] as { parseReport?: Record<string, any> } | undefined)?.parseReport)
    .filter((report): report is Record<string, any> => Boolean(report));
}

function zipOf(files: Record<string, string>): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const [name, body] of Object.entries(files)) data[name] = strToU8(body);
  return zipSync(data);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The CSV shape WeChatMsg/PyWxDump writes, with the voice transcript column. */
const WECHAT_CSV = [
  "IsSender,StrContent,StrTime,Type,SubType,NickName,Transcript",
  "0,3秒,2022-03-01 20:00:00,34,0,小满,今天打 13800138000 聊了会儿",
  "1,打 13800138000,2022-03-01 20:00:05,1,0,阿树,",
].join("\n");

/** A WhatsApp line whose attachment name carries a phone number. */
const WHATSAPP_TEXT = "[3/1/22, 20:00:00] 小满: <attached: IMG_13800138000.jpg>";

/**
 * Two attachments whose file names differ only by the phone number in
 * them, so redaction turns both stored paths into `IMG_[phone].jpg`.
 */
const WHATSAPP_TWO_ATTACHMENTS = [
  "[3/1/22, 20:00:00] 小满: <attached: IMG_13800138000.jpg>",
  "[3/1/22, 20:00:05] 小满: <attached: IMG_13900139000.jpg>",
].join("\n");

/**
 * A Telegram export whose sticker carries both a label and a file path.
 *
 * Instagram/Messenger sticker metadata has a path but no label, and a
 * WhatsApp attachment has a path but the token `[sticker]`, so neither
 * can name the sticker. Telegram records the emoji and the file name
 * together, which is the shape the sticker library groups by.
 */
const TELEGRAM_STICKER_JSON = JSON.stringify({
  name: "和她的聊天",
  type: "private_chat",
  id: 12345,
  messages: [
    {
      id: 1,
      type: "message",
      date: "2022-03-01T20:00:00",
      date_unixtime: "1646136000",
      from: "小满",
      from_id: "user1",
      media_type: "sticker",
      sticker_emoji: "🐶",
      file: "stickers/sticker_13800138000.webp",
      text: "",
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  stored.rows = [];
  getPersonaFileById.mockResolvedValue(file());
  getPersonaById.mockResolvedValue({ id: PERSONA_ID, userId: USER_ID, name: "小满" });
  getUserById.mockResolvedValue({ id: USER_ID, name: "阿树", timezone: "Asia/Shanghai" });
  getUserTimezone.mockResolvedValue("Asia/Shanghai");
  updatePersonaFile.mockResolvedValue(true);
  deleteRecordsByFile.mockResolvedValue(0);
  afterRecordsChanged.mockResolvedValue(null);
  listStickers.mockResolvedValue([]);
  upsertSticker.mockResolvedValue({});
  countStickers.mockResolvedValue(0);
  upsertMedia.mockImplementation(async (data: unknown) => data);
  // The writer's rows are the rows the registrar reads back.
  importRecords.mockImplementation(async (params: { records: Array<Record<string, any>> }) => {
    stored.rows = params.records.map((row, index) => ({
      ...row,
      id: 101 + index,
      fileId: FILE_ID,
      createdAt: new Date("2022-03-01T20:00:00Z"),
    }));
    return params.records.length;
  });
  iterateRecords.mockImplementation(async function* (
    _personaId: number,
    _userId: number,
    options?: { kinds?: string[] },
  ) {
    for (const row of stored.rows) {
      if (options?.kinds && !options.kinds.includes(String(row.kind ?? "text"))) continue;
      yield row;
    }
  });
});

describe("a redacted import keeps the original out of every column (C1.7)", () => {
  it("redacts a voice transcript stored in meta and counts it in the report", async () => {
    const result = await startImport({
      fileId: FILE_ID,
      userId: USER_ID,
      locale: "zh",
      text: WECHAT_CSV,
      format: "wechat-csv",
      me: ["阿树"],
      them: ["小满"],
      redaction: { phones: true },
    });

    expect(result).toMatchObject({ status: "done", written: 2 });
    const rows = writtenRows();
    const voice = rows.find((row) => row.kind === "voice")!;
    expect(voice.meta).toMatchObject({
      durationSec: 3,
      transcript: "今天打 [phone] 聊了会儿",
    });
    // The ordinary content path still works.
    const text = rows.find((row) => row.kind === "text")!;
    expect(text.content).toBe("打 [phone]");

    // Both replacements are in the report, and the report has no original.
    const done = reports().find((report) => report.progress === 100)!;
    expect(done.redaction).toMatchObject({ phones: true });
    expect(done.redaction.replaced.phones).toBe(2);
    expect(JSON.stringify(reports())).not.toContain("13800138000");
    expect(JSON.stringify(rows)).not.toContain("13800138000");
    // No assertion here on `upsertMedia`: a WeChat CSV export has no media
    // file list (`wechat-csv` never sets `meta.path`), so this fixture
    // cannot reach the registrar and `not.toHaveBeenCalled()` was always
    // true. The next test feeds a media path through the real registrar.
  });

  it("puts the redacted transcript into media.transcript, not the original", async () => {
    // A WeChat CSV has no media file list, so the registrar never sees
    // this row. Supply the path a voice row would have after a zip was
    // unpacked and run the real registrar over the row the import wrote:
    // what it copies is `meta.transcript`, so a redacted import cannot
    // put the number back in `media.transcript`.
    await startImport({
      fileId: FILE_ID,
      userId: USER_ID,
      locale: "zh",
      text: WECHAT_CSV,
      format: "wechat-csv",
      me: ["阿树"],
      them: ["小满"],
      redaction: { phones: true },
    });
    const voice = writtenRows().find((row) => row.kind === "voice")!;
    const unpackDir = path.join(ENV.uploadDir, importUnpackRelKey(USER_ID, PERSONA_ID, FILE_ID));
    await mkdir(unpackDir, { recursive: true });
    await writeFile(path.join(unpackDir, "voice.ogg"), "audio-bytes");
    try {
      stored.rows = [
        {
          ...voice,
          id: 501,
          fileId: FILE_ID,
          meta: { ...voice.meta, path: "voice.ogg" },
        },
      ];
      const result = await registerMedia({ personaId: PERSONA_ID, userId: USER_ID, fileId: FILE_ID });
      expect(result.registered).toBe(1);
      const media = upsertMedia.mock.calls.at(-1)![0] as Record<string, any>;
      expect(media.transcript).toBe("今天打 [phone] 聊了会儿");
      expect(media.transcriptEngine).toBe("import");
      expect(JSON.stringify(media)).not.toContain("13800138000");
    } finally {
      await rm(unpackDir, { recursive: true, force: true });
    }
  });

  it("redacts a media path and still registers the file it names (C1.7)", async () => {
    const unpackRel = importUnpackRelKey(USER_ID, PERSONA_ID, FILE_ID);
    const unpackDir = path.join(ENV.uploadDir, unpackRel);
    getPersonaFileById.mockResolvedValue(file("archive", "chats.zip"));
    try {
      const result = await startImport({
        fileId: FILE_ID,
        userId: USER_ID,
        locale: "zh",
        bytes: zipOf({
          "chat.txt": WHATSAPP_TEXT,
          "IMG_13800138000.jpg": "jpeg-bytes",
        }),
        format: "whatsapp-txt",
        me: ["阿树"],
        them: ["小满"],
        redaction: { phones: true },
      });

      expect(result).toMatchObject({ status: "done", written: 1 });
      const rows = writtenRows();
      const image = rows.find((row) => row.kind === "image")!;
      // The stored name is the redacted one...
      expect(image.meta.path).toBe("IMG_[phone].jpg");
      expect(JSON.stringify(rows)).not.toContain("13800138000");
      // ...and the media row still found the bytes, but it points at a
      // content-addressed copy: the browser gets `/uploads/<fileKey>`, so
      // a key that kept the phone number would give the number back.
      const media = upsertMedia.mock.calls.at(-1)![0] as Record<string, any>;
      expect(media.kind).toBe("photo");
      expect(media.fileKey).toBe(`${unpackRel}/${sha256("jpeg-bytes")}.jpg`);
      expect(media.fileKey).not.toContain("13800138000");
      // The record router serves the media row as this URL (record.ts), so
      // the URL cannot carry the name either.
      expect(`/uploads/${media.fileKey}`).not.toContain("13800138000");
      expect(media.hash).toBe(sha256("jpeg-bytes"));
      await expect(readFile(path.join(ENV.uploadDir, media.fileKey), "utf8"))
        .resolves.toBe("jpeg-bytes");
      // The export's own file stays on disk for the sticker registrar; the
      // import directory is deleted as a unit.
      await expect(readFile(path.join(unpackDir, "IMG_13800138000.jpg"), "utf8"))
        .resolves.toBe("jpeg-bytes");
      // The report's media file list is redacted too.
      const done = reports().find((report) => report.progress === 100)!;
      expect((done.mediaFiles as string[]).join(" ")).toContain("[phone]");
      expect(JSON.stringify(reports())).not.toContain("13800138000");
    } finally {
      await rm(unpackDir, { recursive: true, force: true });
    }
  });

  it("registers both files when two original names redact to one token (C1.7)", async () => {
    const unpackRel = importUnpackRelKey(USER_ID, PERSONA_ID, FILE_ID);
    const unpackDir = path.join(ENV.uploadDir, unpackRel);
    getPersonaFileById.mockResolvedValue(file("archive", "chats.zip"));
    try {
      const result = await startImport({
        fileId: FILE_ID,
        userId: USER_ID,
        locale: "zh",
        bytes: zipOf({
          "chat.txt": WHATSAPP_TWO_ATTACHMENTS,
          "IMG_13800138000.jpg": "jpeg-one",
          "IMG_13900139000.jpg": "jpeg-two",
        }),
        format: "whatsapp-txt",
        me: ["阿树"],
        them: ["小满"],
        redaction: { phones: true },
      });

      expect(result).toMatchObject({ status: "done", written: 2 });
      const rows = writtenRows();
      // Both stored paths are the same token now, so the registrar cannot
      // tell the two files apart by the stored name alone.
      expect(rows.map((row) => row.meta.path)).toEqual(["IMG_[phone].jpg", "IMG_[phone].jpg"]);
      expect(JSON.stringify(rows)).not.toContain("13800138000");

      const calls = upsertMedia.mock.calls.map((call) => call[0] as Record<string, any>);
      expect(calls).toHaveLength(2);
      const keys = calls.map((call) => String(call.fileKey));
      // Each record resolves its own original file, so both files are
      // registered — the second one used to be dropped on the floor.
      expect(new Set(keys).size).toBe(2);
      for (const key of keys) {
        expect(key).not.toContain("13800138000");
        expect(key).not.toContain("13900139000");
      }
      const contents = await Promise.all(
        keys.map((key) => readFile(path.join(ENV.uploadDir, key), "utf8")),
      );
      // The rows are read back in write order, so the first record must
      // have found the first file — not both rows hitting the same one.
      expect(contents).toEqual(["jpeg-one", "jpeg-two"]);
      expect(new Set(calls.map((call) => String(call.hash))).size).toBe(2);
    } finally {
      await rm(unpackDir, { recursive: true, force: true });
    }
  });

  it("reuses the registered sticker when a later scan cannot find the source (C1.7)", async () => {
    const unpackRel = importUnpackRelKey(USER_ID, PERSONA_ID, FILE_ID);
    const unpackDir = path.join(ENV.uploadDir, unpackRel);
    const stickerSource = path.join(unpackDir, "stickers", "sticker_13800138000.webp");
    getPersonaFileById.mockResolvedValue(file("archive", "chats.zip"));
    let storedCopy: string | null = null;
    try {
      const first = await startImport({
        fileId: FILE_ID,
        userId: USER_ID,
        locale: "zh",
        bytes: zipOf({
          "result.json": TELEGRAM_STICKER_JSON,
          "stickers/sticker_13800138000.webp": "sticker-bytes",
        }),
        format: "telegram-json",
        me: ["阿树"],
        them: ["小满"],
        redaction: { phones: true },
      });

      expect(first).toMatchObject({ status: "done", written: 1 });
      // The first import found the file and copied it out under its hash,
      // so the sticker row does not depend on the import directory.
      expect(upsertSticker).toHaveBeenCalledTimes(1);
      const registered = upsertSticker.mock.calls[0]![0] as Record<string, any>;
      expect(String(registered.key)).toMatch(/^[0-9a-f]{32}$/);
      expect(registered.label).toBe("🐶");
      expect(String(registered.fileKey)).toContain("/stickers/");
      storedCopy = path.join(ENV.uploadDir, String(registered.fileKey));
      await expect(stat(storedCopy)).resolves.toBeTruthy();

      // The import directory goes away with the import; a later scan sees
      // the redacted row but not the file it names. It must not add an
      // image-less `label:` duplicate of the sticker it already has.
      await rm(stickerSource, { force: true });
      listStickers.mockResolvedValue([{ id: 1, ...registered }]);
      upsertSticker.mockClear();

      const again = await registerStickers({ personaId: PERSONA_ID, userId: USER_ID });

      expect(again.registered).toBe(1);
      // Nothing was copied again: the bytes are already in the library.
      expect(again.copied).toBe(0);
      const calls = upsertSticker.mock.calls.map((call) => call[0] as Record<string, any>);
      expect(calls).toHaveLength(1);
      expect(calls.some((call) => String(call.key).startsWith("label:"))).toBe(false);
      expect(calls[0]!.key).toBe(registered.key);
      expect(calls[0]!.fileKey).toBe(registered.fileKey);
    } finally {
      if (storedCopy) await rm(storedCopy, { force: true });
      await rm(unpackDir, { recursive: true, force: true });
    }
  });

  it("leaves an import without redaction exactly as it was", async () => {
    const result = await startImport({
      fileId: FILE_ID,
      userId: USER_ID,
      locale: "zh",
      text: WECHAT_CSV,
      format: "wechat-csv",
      me: ["阿树"],
      them: ["小满"],
    });
    expect(result).toMatchObject({ status: "done", written: 2 });
    const rows = writtenRows();
    expect(rows.find((row) => row.kind === "voice")!.meta.transcript)
      .toBe("今天打 13800138000 聊了会儿");
    expect(rows.find((row) => row.kind === "text")!.content).toBe("打 13800138000");
    const done = reports().find((report) => report.progress === 100)!;
    expect(done.redaction).toBeUndefined();
  });
});
