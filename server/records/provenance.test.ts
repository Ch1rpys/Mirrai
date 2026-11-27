import { beforeEach, describe, expect, it, vi } from "vitest";

const candidateRecordsByOverlap = vi.fn();
const updateMessageMetadata = vi.fn();

vi.mock("../db", () => ({
  candidateRecordsByOverlap: (...a: unknown[]) => candidateRecordsByOverlap(...a),
  updateMessageMetadata: (...a: unknown[]) => updateMessageMetadata(...a),
}));

import { attachMessageProvenance, computeProvenance } from "./provenance";

function row(id: number, content: string, at = "2023-03-04T12:00:00.000Z") {
  return { id, content, timestamp: new Date(at), role: "assistant", speaker: "小满", coverage: 1 };
}

describe("the provenance of a reply", () => {
  beforeEach(() => {
    candidateRecordsByOverlap.mockReset();
    updateMessageMetadata.mockReset();
    candidateRecordsByOverlap.mockResolvedValue([]);
    updateMessageMetadata.mockResolvedValue(true);
  });

  it("marks a fixed reply whole, from the record it names", async () => {
    candidateRecordsByOverlap.mockResolvedValue([row(11, "晚安")]);
    const spans = await computeProvenance({
      personaId: 5,
      userId: 1,
      text: "晚安",
      forcedRecordId: 11,
      wholeTextIsVerbatim: true,
    });
    expect(spans).toEqual([{ start: 0, end: 2, recordId: 11, at: "2023-03-04T12:00:00.000Z" }]);
  });

  it("keeps the record id of a fixed reply even when the search finds nothing", async () => {
    const spans = await computeProvenance({
      personaId: 5,
      userId: 1,
      text: "晚安",
      forcedRecordId: 11,
      wholeTextIsVerbatim: true,
    });
    expect(spans).toEqual([{ start: 0, end: 2, recordId: 11, at: null }]);
  });

  it("marks only the sentence that the record actually says", async () => {
    candidateRecordsByOverlap.mockImplementation(async (_personaId: number, _userId: number, params: { text: string }) => (
      params.text.replace(/。$/, "") === "我想你了" ? [row(12, "我想你了")] : []
    ));
    const text = "今天下雨了。我想你了。晚安";
    const spans = await computeProvenance({ personaId: 5, userId: 1, text });
    // The sentence is marked with its full stop; C2.3 compares without
    // punctuation, which is how the record's "我想你了" matches it.
    expect(spans).toEqual([
      {
        start: text.indexOf("我想你了"),
        end: text.indexOf("我想你了") + "我想你了。".length,
        recordId: 12,
        at: "2023-03-04T12:00:00.000Z",
      },
    ]);
    expect(spans).toHaveLength(1);
  });

  it("marks nothing when nothing matches", async () => {
    const spans = await computeProvenance({
      personaId: 5,
      userId: 1,
      text: "今天下雨了。我想你了。晚安",
    });
    expect(spans).toEqual([]);
  });

  it("does not underline one or two characters just because a line contains them", async () => {
    // "好" is inside every other line; only an exact line counts, and a
    // contained line has to be four characters up (the C2.3 rule).
    candidateRecordsByOverlap.mockImplementation(async (_personaId: number, _userId: number, params: { text: string }) => (
      params.text.length < 4
        ? [row(20, `好的${params.text}呀`)]
        : [row(21, `那就${params.text}吧`)]
    ));
    const short = await computeProvenance({ personaId: 5, userId: 1, text: "好" });
    expect(short).toEqual([]);

    const three = await computeProvenance({ personaId: 5, userId: 1, text: "晚安啦" });
    expect(three).toEqual([]);

    const four = await computeProvenance({ personaId: 5, userId: 1, text: "我想你了" });
    expect(four).toHaveLength(1);
  });

  it("can be pointed at a fake record lookup", async () => {
    const spans = await computeProvenance({
      personaId: 5,
      userId: 1,
      text: "在的呀。晚安",
      findVerbatim: async (text) => (
        text.replace(/。$/, "") === "在的呀" ? (row(30, "在的呀") as never) : null
      ),
    });
    expect(spans.map((span) => span.recordId)).toEqual([30]);
  });

  it("writes the spans onto the stored message", async () => {
    candidateRecordsByOverlap.mockResolvedValue([row(11, "晚安")]);
    const spans = await attachMessageProvenance({
      messageId: 99,
      personaId: 5,
      userId: 1,
      text: "晚安",
      forcedRecordId: 11,
      wholeTextIsVerbatim: true,
    });
    expect(spans).toHaveLength(1);
    expect(updateMessageMetadata).toHaveBeenCalledWith(99, 1, 5, {
      provenance: [{ start: 0, end: 2, recordId: 11, at: "2023-03-04T12:00:00.000Z" }],
    });
  });

  it("does nothing, and does not throw, when the lookup fails", async () => {
    candidateRecordsByOverlap.mockRejectedValue(new Error("database is down"));
    const spans = await attachMessageProvenance({
      messageId: 99,
      personaId: 5,
      userId: 1,
      text: "晚安",
      forcedRecordId: 11,
      wholeTextIsVerbatim: true,
    });
    expect(spans).toBeNull();
    expect(updateMessageMetadata).not.toHaveBeenCalled();
  });
});
