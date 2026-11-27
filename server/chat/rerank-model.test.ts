import { beforeEach, describe, expect, it, vi } from "vitest";

const iterateRecords = vi.fn();
const recentRecordTexts = vi.fn();
const getRecordsVersion = vi.fn();

vi.mock("../db", () => ({
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
  recentRecordTexts: (...a: unknown[]) => recentRecordTexts(...a),
  getRecordsVersion: (...a: unknown[]) => getRecordsVersion(...a),
}));

import {
  clearRerankModelCache,
  getRerankModel,
  RERANK_TEXT_CAP,
} from "./rerank-model";

function yieldTexts(texts: string[]) {
  recentRecordTexts.mockResolvedValue(texts);
}

describe("getRerankModel", () => {
  beforeEach(() => {
    clearRerankModelCache();
    iterateRecords.mockReset();
    recentRecordTexts.mockReset();
    getRecordsVersion.mockReset();
    getRecordsVersion.mockResolvedValue("40:40");
  });

  it("returns null when there are fewer than forty lines", async () => {
    yieldTexts(Array.from({ length: 39 }, (_, i) => `嗯${i}`));
    expect(await getRerankModel(7, 1)).toBeNull();
  });

  it("does not re-read the records for the same version", async () => {
    yieldTexts(Array.from({ length: 40 }, (_, i) => `嗯${i}`));
    const first = await getRerankModel(7, 1);
    expect(first?.texts).toHaveLength(40);
    // The model is built from one ordered, limited query, not by walking
    // the whole record table (C8.7).
    expect(recentRecordTexts).toHaveBeenCalledWith(7, 1, RERANK_TEXT_CAP);
    expect(iterateRecords).not.toHaveBeenCalled();
    recentRecordTexts.mockClear();
    const second = await getRerankModel(7, 1);
    expect(second).toBe(first);
    expect(recentRecordTexts).not.toHaveBeenCalled();
    // The version itself is still asked for: that is how a changed
    // record set is noticed without reading every line again.
    expect(getRecordsVersion).toHaveBeenCalledTimes(2);
  });

  it("rebuilds after the records version changes", async () => {
    yieldTexts(Array.from({ length: 40 }, (_, i) => `嗯${i}`));
    await getRerankModel(7, 1);
    getRecordsVersion.mockResolvedValue("41:99");
    yieldTexts(Array.from({ length: 41 }, (_, i) => `好${i}`));
    const rebuilt = await getRerankModel(7, 1);
    expect(rebuilt?.texts).toHaveLength(41);
    expect(rebuilt?.texts[0]).toBe("好0");
    expect(recentRecordTexts).toHaveBeenCalledTimes(2);
  });

  it("keeps only the most recent five thousand lines", async () => {
    // The reader is what enforces the cap now: the model is handed the
    // newest lines only, in reading order.
    const n = RERANK_TEXT_CAP + 3;
    yieldTexts(Array.from({ length: RERANK_TEXT_CAP }, (_, i) => `行${i + 3}`));
    const model = await getRerankModel(7, 1);
    expect(recentRecordTexts).toHaveBeenCalledWith(7, 1, RERANK_TEXT_CAP);
    expect(model?.texts).toHaveLength(RERANK_TEXT_CAP);
    expect(model?.texts[0]).toBe("行3");
    expect(model?.texts.at(-1)).toBe(`行${n - 1}`);
  });
});
