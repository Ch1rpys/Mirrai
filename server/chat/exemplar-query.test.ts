import { beforeEach, describe, expect, it, vi } from "vitest";

const countRecords = vi.fn();
const candidateRecordsByOverlap = vi.fn();
const getWindowsAroundUserRecords = vi.fn();
const getCollectedMessagesForPersona = vi.fn();
const iterateRecords = vi.fn();
const retrieveExemplarsWithEmbed = vi.fn();

vi.mock("../db", () => ({
  countRecords: (...a: unknown[]) => countRecords(...a),
  candidateRecordsByOverlap: (...a: unknown[]) => candidateRecordsByOverlap(...a),
  getWindowsAroundUserRecords: (...a: unknown[]) => getWindowsAroundUserRecords(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersona(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
}));

vi.mock("./embeddings", () => ({
  retrieveExemplarsWithEmbed: (...a: unknown[]) => retrieveExemplarsWithEmbed(...a),
}));

import { retrieveExemplarsFromTable } from "./exemplar-query";

const at = (iso: string) => new Date(iso);
const candidate = {
  id: 11,
  userId: 1,
  personaId: 5,
  source: "generic",
  role: "user",
  content: "在吗",
  timestamp: at("2022-03-01T12:00:00.000Z"),
  createdAt: at("2022-03-01T12:00:00.000Z"),
  kind: "text",
  speaker: "阿树",
};
const reply = {
  ...candidate,
  id: 12,
  role: "assistant",
  content: "在的呀",
  speaker: "小满",
};

beforeEach(() => {
  vi.clearAllMocks();
  countRecords.mockImplementation(
    async (_personaId: number, _userId: number, options: { tokensMissing?: boolean } = {}) =>
      options.tokensMissing ? 0 : 10,
  );
  candidateRecordsByOverlap.mockResolvedValue([candidate]);
  getWindowsAroundUserRecords.mockResolvedValue(
    new Map([[11, { candidate, before: [], after: [reply] }]]),
  );
  retrieveExemplarsWithEmbed.mockResolvedValue([{ id: 12, content: "在的呀" }]);
});

describe("exemplars from the index", () => {
  it("asks the index instead of reading the history", async () => {
    const found = await retrieveExemplarsFromTable({
      personaId: 5,
      userId: 1,
      userMessage: "在吗",
    });
    expect(found).toEqual([{ id: 12, content: "在的呀" }]);
    expect(candidateRecordsByOverlap).toHaveBeenCalledWith(
      5,
      1,
      expect.objectContaining({ text: "在吗", role: "user", limit: 200 }),
    );
    expect(getCollectedMessagesForPersona).toHaveBeenCalledTimes(0);
    expect(iterateRecords).toHaveBeenCalledTimes(0);
  });

  it("passes the selected period as a time range", async () => {
    await retrieveExemplarsFromTable({
      personaId: 5,
      userId: 1,
      userMessage: "在吗",
      period: { from: "2022-01-01T00:00:00.000Z", to: "2022-12-31T23:59:59.000Z" },
    });
    const params = candidateRecordsByOverlap.mock.calls[0][2];
    expect(params.from).toEqual(new Date("2022-01-01T00:00:00.000Z"));
    expect(params.to).toEqual(new Date("2022-12-31T23:59:59.000Z"));
  });

  it("uses the old path when rows still have no search tokens", async () => {
    countRecords.mockImplementation(async (_p: number, _u: number, options: { tokensMissing?: boolean } = {}) =>
      options.tokensMissing ? 3 : 10,
    );
    await expect(
      retrieveExemplarsFromTable({ personaId: 5, userId: 1, userMessage: "在吗" }),
    ).resolves.toBeNull();
    expect(candidateRecordsByOverlap).toHaveBeenCalledTimes(0);
    expect(getCollectedMessagesForPersona).toHaveBeenCalledTimes(0);
  });

  it("uses the old path when the persona has no records at all", async () => {
    countRecords.mockResolvedValue(0);
    await expect(
      retrieveExemplarsFromTable({ personaId: 5, userId: 1, userMessage: "在吗" }),
    ).resolves.toBeNull();
    expect(candidateRecordsByOverlap).toHaveBeenCalledTimes(0);
  });

  it("returns nothing when the index has no overlapping line", async () => {
    candidateRecordsByOverlap.mockResolvedValue([]);
    await expect(
      retrieveExemplarsFromTable({ personaId: 5, userId: 1, userMessage: "在吗" }),
    ).resolves.toEqual([]);
    expect(retrieveExemplarsWithEmbed).toHaveBeenCalledTimes(0);
  });
});
