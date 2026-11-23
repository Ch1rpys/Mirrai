import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderFixture } from "../test-fixtures/render";
import { buildGroupFixture, buildXiaomanRecords } from "../test-fixtures/xiaoman";

/**
 * Importing a group chat (C9.8).
 *
 * The wizard names me, TA, and everyone else is `other`. Those rows are
 * stamped with `meta.register = "group"` so the group lines never reach
 * the one-to-one measurements. An ordinary import — private, or simply
 * without a mode — must look exactly as it did before the flag existed.
 */
const getPersonaFileById = vi.hoisted(() => vi.fn());
const getPersonaById = vi.hoisted(() => vi.fn());
const getUserById = vi.hoisted(() => vi.fn());
const getUserTimezone = vi.hoisted(() => vi.fn());
const updatePersonaFile = vi.hoisted(() => vi.fn());
const deleteRecordsByFile = vi.hoisted(() => vi.fn());
const importRecords = vi.hoisted(() => vi.fn());
const afterRecordsChanged = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  getPersonaFileById: (...a: unknown[]) => getPersonaFileById(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  updatePersonaFile: (...a: unknown[]) => updatePersonaFile(...a),
  deleteRecordsByFile: (...a: unknown[]) => deleteRecordsByFile(...a),
}));

vi.mock("../collectors/db-store", () => ({
  importRecords: (...a: unknown[]) => importRecords(...a),
  RecordLimitError: class RecordLimitError extends Error {},
}));

vi.mock("../_core/style-profile", () => ({
  afterRecordsChanged: (...a: unknown[]) => afterRecordsChanged(...a),
}));

vi.mock("./stickers", () => ({ registerStickers: vi.fn() }));
vi.mock("./media", () => ({ registerMedia: vi.fn() }));

import { startImport } from "./index";

const GROUP_RECORDS = buildGroupFixture();
const GROUP_TEXT = renderFixture(GROUP_RECORDS, "generic-line");
const PRIVATE_TEXT = renderFixture(buildXiaomanRecords(), "wechat-txt-2line");

type WrittenRow = Record<string, any>;

function file(id: number, name: string, size: number) {
  return {
    id,
    userId: 1,
    personaId: 5,
    fileType: "chat_txt",
    originalName: name,
    fileKey: `personas/1/5/${name}`,
    fileUrl: `/uploads/${name}`,
    fileSize: size,
    processStatus: "done",
    parseStatus: "needs_roles",
    parseReport: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function writtenRows(call = 0): WrittenRow[] {
  const params = importRecords.mock.calls[call]?.[0] as { records: WrittenRow[] } | undefined;
  return params?.records ?? [];
}

describe("importing a group chat (C9.8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaFileById.mockImplementation(async (id: number) =>
      file(id, id === 21 ? "group.txt" : "private.txt", 0),
    );
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getUserById.mockResolvedValue({ id: 1, name: "阿树", timezone: "Asia/Shanghai" });
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    updatePersonaFile.mockResolvedValue(true);
    deleteRecordsByFile.mockResolvedValue(0);
    importRecords.mockImplementation(async (params: { records: unknown[] }) => params.records.length);
    afterRecordsChanged.mockResolvedValue(null);
  });

  it("writes every group row in the group register and leaves the third speaker other", async () => {
    const result = await startImport({
      fileId: 21,
      userId: 1,
      format: "generic-line",
      text: GROUP_TEXT,
      me: ["阿树"],
      them: ["小满"],
      mode: "group",
    });

    expect(result).toEqual({ status: "done", written: GROUP_RECORDS.length });
    const rows = writtenRows();
    expect(rows).toHaveLength(GROUP_RECORDS.length);
    // The stamp reaches the writer on every row, not only on the first
    // page or on the speakers the wizard named.
    for (const row of rows) {
      expect(row.meta).toMatchObject({ register: "group" });
    }
    const bySpeaker = (name: string) => rows.filter((row) => row.speaker === name);
    const designed = (role: string) => GROUP_RECORDS.filter((row) => row.role === role).length;
    expect(bySpeaker("阿树")).toHaveLength(designed("user"));
    expect(bySpeaker("小满")).toHaveLength(designed("assistant"));
    expect(bySpeaker("琪琪")).toHaveLength(designed("other"));
    expect(rows).toHaveLength(GROUP_RECORDS.length);
    expect(bySpeaker("阿树").every((row) => row.role === "user")).toBe(true);
    expect(bySpeaker("小满").every((row) => row.role === "assistant")).toBe(true);
    // The rule the feature is for: everyone who is not me or TA is
    // `other`, not quietly assistant.
    expect(bySpeaker("琪琪").every((row) => row.role === "other")).toBe(true);
  });

  it("does not add a register when no mode is given", async () => {
    await startImport({
      fileId: 21,
      userId: 1,
      format: "generic-line",
      text: GROUP_TEXT,
      me: ["阿树"],
      them: ["小满"],
    });

    const rows = writtenRows();
    expect(rows).toHaveLength(GROUP_RECORDS.length);
    for (const row of rows) {
      expect(row.meta?.register).toBeUndefined();
    }
    expect(rows[0]).not.toHaveProperty("meta");
  });

  it("keeps a private two-speaker import unchanged, with or without an explicit private mode", async () => {
    const common = {
      userId: 1,
      format: "wechat-txt-2line" as const,
      text: PRIVATE_TEXT,
      me: ["阿树"],
      them: ["小满"],
    };
    await startImport({ ...common, fileId: 21 });
    await startImport({ ...common, fileId: 21, mode: "private" });

    const withoutMode = writtenRows(0);
    const explicitPrivate = writtenRows(1);
    expect(withoutMode.length).toBeGreaterThan(0);
    // Byte-identical rows: the private path never grew a register key.
    expect(explicitPrivate).toEqual(withoutMode);
    for (const row of explicitPrivate) {
      expect(row.meta).toBeUndefined();
    }
    expect(
      explicitPrivate.every((row) => row.role === "user" || row.role === "assistant"),
    ).toBe(true);
  });
});
