import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The monologue import writes what the person wrote as the persona's own
 * rows, in the `written` register, without asking anybody to name two
 * sides that are not there.
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

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../test-fixtures/exports/monologue/sample.txt"),
  "utf8",
);

function file() {
  return {
    id: 4,
    userId: 1,
    personaId: 5,
    fileType: "chat_txt",
    originalName: "diary.txt",
    fileKey: "personas/1/5/diary.txt",
    fileUrl: "/uploads/diary.txt",
    fileSize: SAMPLE.length,
    processStatus: "done",
    parseStatus: "needs_format",
    parseReport: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("importing a monologue (C1.8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaFileById.mockResolvedValue(file());
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getUserById.mockResolvedValue({ id: 1, name: "阿树", timezone: "Asia/Shanghai" });
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    updatePersonaFile.mockResolvedValue(true);
    deleteRecordsByFile.mockResolvedValue(0);
    importRecords.mockResolvedValue(3);
    afterRecordsChanged.mockResolvedValue(null);
  });

  it("writes each paragraph as the persona's own written words", async () => {
    const result = await startImport({
      fileId: 4,
      userId: 1,
      format: "monologue",
      bytes: Buffer.from(SAMPLE, "utf8"),
    });
    expect(result).toEqual({ status: "done", written: 3 });

    const rows = importRecords.mock.calls[0]?.[0]?.records as Array<Record<string, any>>;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.role).toBe("assistant");
      expect(row.kind).toBe("text");
      expect(row.meta).toEqual({ register: "written" });
    }
    expect(rows[0]?.content).toContain("今天去了海边");
    expect(rows[0]?.timestamp).toBeInstanceOf(Date);
  });

  it("does not stop to ask who is who", async () => {
    await startImport({
      fileId: 4,
      userId: 1,
      format: "monologue",
      bytes: Buffer.from(SAMPLE, "utf8"),
    });
    const statuses = updatePersonaFile.mock.calls.map(
      ([, , patch]) => (patch as Record<string, any>)?.parseStatus,
    );
    expect(statuses).not.toContain("needs_roles");
    expect(statuses).toContain("done");
  });

  it("keeps the private measurements untouched by the written rows", async () => {
    await startImport({
      fileId: 4,
      userId: 1,
      format: "monologue",
      bytes: Buffer.from(SAMPLE, "utf8"),
    });
    // The records are written; the measurements are remade from the
    // private register, which has none of them (checked in
    // server/_core/style-profile.test.ts).
    expect(afterRecordsChanged).toHaveBeenCalledWith({
      personaId: 5,
      userId: 1,
      added: 3,
    });
  });
});
