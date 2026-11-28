import { mkdir, rm, writeFile } from "node:fs/promises";
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

/** The CSV shape WeChatMsg/PyWxDump writes, with the voice transcript column. */
const WECHAT_CSV = [
  "IsSender,StrContent,StrTime,Type,SubType,NickName,Transcript",
  "0,3秒,2022-03-01 20:00:00,34,0,小满,今天打 13800138000 聊了会儿",
  "1,打 13800138000,2022-03-01 20:00:05,1,0,阿树,",
].join("\n");

/** A WhatsApp line whose attachment name carries a phone number. */
const WHATSAPP_TEXT = "[3/1/22, 20:00:00] 小满: <attached: IMG_13800138000.jpg>";

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
    // The transcript was not copied into the media row as the original.
    expect(upsertMedia).not.toHaveBeenCalled();
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
    const unpackDir = path.join(ENV.uploadDir, importUnpackRelKey(USER_ID, PERSONA_ID, FILE_ID));
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
      // ...but the row still found the file, which kept its own name on
      // disk for this import, and the media row points at the bytes.
      const media = upsertMedia.mock.calls.at(-1)![0] as Record<string, any>;
      expect(media.kind).toBe("photo");
      expect(media.fileKey).toBe(
        `${importUnpackRelKey(USER_ID, PERSONA_ID, FILE_ID)}/IMG_13800138000.jpg`,
      );
      // The report's media file list is redacted too.
      const done = reports().find((report) => report.progress === 100)!;
      expect((done.mediaFiles as string[]).join(" ")).toContain("[phone]");
      expect(JSON.stringify(reports())).not.toContain("13800138000");
    } finally {
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
