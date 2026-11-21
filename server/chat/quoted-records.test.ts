import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A stretch of the record taken into a conversation (C8.10).
 *
 * The user selects a few consecutive lines in the record reader and
 * brings them into a turn. The check that matters is that the lines are
 * this persona's, that there are not too many, and that the section is
 * dated — it is a quotation, not a second conversation.
 */
const getRecordsByIds = vi.fn();

vi.mock("../db", () => ({
  getRecordsByIds: (...a: unknown[]) => getRecordsByIds(...a),
}));

import {
  MAX_QUOTED_CHARS,
  MAX_QUOTED_RECORDS,
  QuotedRecordsError,
  buildQuotedRecordsSection,
  loadQuotedRecordsSection,
} from "./quoted-records";

const persona = { id: 5, name: "小满" };

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    personaId: 5,
    userId: 1,
    role: "user",
    speaker: "阿树",
    content: "说好的 周末看电影",
    timestamp: new Date("2023-05-01T12:00:00.000Z"),
    createdAt: new Date("2023-05-01T12:00:00.000Z"),
    ...overrides,
  };
}

describe("the quoted section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dates every line and says who said it", () => {
    const section = buildQuotedRecordsSection(
      [
        record({ id: 101, role: "user", content: "说好的 周末看电影" }),
        record({ id: 102, role: "assistant", speaker: "小满", content: "好啊" }),
      ],
      { locale: "zh", timeZone: "Asia/Shanghai", themName: "小满" },
    );
    // 2023-05-01T12:00Z is the evening of the 1st in Shanghai.
    expect(section).toContain("2023-05-01");
    expect(section).toContain("说好的 周末看电影");
    expect(section).toContain("好啊");
    expect(section).toContain("小满");
  });

  it("refuses more than eight lines", async () => {
    await expect(loadQuotedRecordsSection({
      persona,
      userId: 1,
      ids: Array.from({ length: MAX_QUOTED_RECORDS + 1 }, (_, index) => index + 1),
      locale: "zh",
    })).rejects.toBeInstanceOf(QuotedRecordsError);
    expect(getRecordsByIds).not.toHaveBeenCalled();
  });

  it("refuses a line that belongs to another persona", async () => {
    getRecordsByIds.mockResolvedValue([record({ personaId: 6 })]);
    await expect(loadQuotedRecordsSection({
      persona,
      userId: 1,
      ids: [101],
      locale: "zh",
    })).rejects.toMatchObject({ name: "QuotedRecordsError" });
  });

  it("refuses a line that is not in the record", async () => {
    getRecordsByIds.mockResolvedValue([]);
    await expect(loadQuotedRecordsSection({
      persona,
      userId: 1,
      ids: [101],
      locale: "zh",
    })).rejects.toBeInstanceOf(QuotedRecordsError);
  });

  it("refuses more than the character limit", async () => {
    getRecordsByIds.mockResolvedValue([
      record({ content: "字".repeat(MAX_QUOTED_CHARS + 1) }),
    ]);
    await expect(loadQuotedRecordsSection({
      persona,
      userId: 1,
      ids: [101],
      locale: "zh",
    })).rejects.toBeInstanceOf(QuotedRecordsError);
  });

  it("returns the section for lines that are this persona's", async () => {
    getRecordsByIds.mockResolvedValue([
      record({ id: 101 }),
      record({ id: 102, role: "assistant", speaker: "小满", content: "好啊" }),
    ]);
    const section = await loadQuotedRecordsSection({
      persona,
      userId: 1,
      ids: [101, 102],
      locale: "zh",
      timeZone: "Asia/Shanghai",
    });
    expect(getRecordsByIds).toHaveBeenCalledWith([101, 102], 1);
    expect(section).toContain("说好的 周末看电影");
    expect(section).toContain("2023-05-01");
  });

  it("is empty when nothing was quoted", async () => {
    expect(await loadQuotedRecordsSection({
      persona,
      userId: 1,
      ids: [],
      locale: "zh",
    })).toBe("");
    expect(getRecordsByIds).not.toHaveBeenCalled();
  });
});
