import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retrieveExemplars } from "./exemplars";

const {
  listRecordEmbeddings,
  getRecordsVersion,
  listEmbeddedRecordIds,
  iterateRecords,
  upsertRecordEmbedding,
} = vi.hoisted(() => ({
  listRecordEmbeddings: vi.fn(),
  getRecordsVersion: vi.fn(),
  listEmbeddedRecordIds: vi.fn(),
  iterateRecords: vi.fn(),
  upsertRecordEmbedding: vi.fn(),
}));

vi.mock("../db", () => ({
  listRecordEmbeddings: (...a: unknown[]) => listRecordEmbeddings(...a),
  getRecordsVersion: (...a: unknown[]) => getRecordsVersion(...a),
  listEmbeddedRecordIds: (...a: unknown[]) => listEmbeddedRecordIds(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
  upsertRecordEmbedding: (...a: unknown[]) => upsertRecordEmbedding(...a),
}));

import {
  clearEmbedCache,
  cosine,
  dequantizeInt8,
  embedPersonaTurns,
  embedTexts,
  l2Normalize,
  packEmbedding,
  probeEmbedStatus,
  quantizeInt8,
  retrieveExemplarsWithEmbed,
} from "./embeddings";

const records = [
  { id: 1, role: "user" as const, content: "沙滩那边风好大" },
  { id: 2, role: "assistant" as const, content: "那不去了" },
  { id: 3, role: "user" as const, content: "今晚吃什么" },
  { id: 4, role: "assistant" as const, content: "随便，你定" },
];

const beach = l2Normalize([1, 0, 0, 0]);
const dinner = l2Normalize([0, 1, 0, 0]);

afterEach(() => {
  vi.unstubAllGlobals();
  clearEmbedCache();
});

beforeEach(() => {
  vi.clearAllMocks();
  listRecordEmbeddings.mockResolvedValue([]);
  getRecordsVersion.mockResolvedValue("4:4");
  listEmbeddedRecordIds.mockResolvedValue([]);
  iterateRecords.mockImplementation(async function* () {});
  upsertRecordEmbedding.mockResolvedValue(undefined);
});

describe("local embeddings", () => {
  it("returns null when Ollama is unreachable, and retrieval matches the literal path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    expect(await embedTexts(["海边"])).toBeNull();
    const without = retrieveExemplars({
      userMessage: "海边",
      records,
      minScore: 0.05,
    });
    const withEmbed = retrieveExemplars({
      userMessage: "海边",
      records,
      minScore: 0.05,
      embedCosine: () => null,
    });
    expect(withEmbed).toEqual(without);
  });

  it("retrieves a turn whose previous user line is close in the fake embed space", () => {
    const found = retrieveExemplars({
      userMessage: "海边",
      records,
      minScore: 0.05,
      embedCosine: (previousUser) => {
        if (previousUser.includes("沙滩") || previousUser.includes("海边")) return 0.92;
        return 0;
      },
    });
    expect(found.some((item) => item.previousUser.includes("沙滩"))).toBe(true);
  });

  it("round-trips a unit vector through int8 with cosine error below 0.02", () => {
    const raw = Array.from({ length: 64 }, (_, i) => Math.sin(i + 0.3));
    const unit = l2Normalize(raw);
    const restored = dequantizeInt8(quantizeInt8(unit));
    expect(1 - cosine(unit, restored)).toBeLessThan(0.02);
  });

  it("does not call fetch when no vectors are stored", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const found = await retrieveExemplarsWithEmbed({
      userMessage: "海边",
      records,
      minScore: 0.05,
      personaId: 5,
      userId: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(found).toEqual(
      retrieveExemplars({ userMessage: "海边", records, minScore: 0.05 }),
    );
  });

  it("retrieves a stored turn from a nearby query embedding", async () => {
    listRecordEmbeddings.mockResolvedValue([
      { recordId: 1, dim: 4, vec: packEmbedding(beach) },
      { recordId: 3, dim: 4, vec: packEmbedding(dinner) },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/embed")) {
          return {
            ok: true,
            json: async () => ({ embeddings: [beach] }),
          };
        }
        return { ok: false, json: async () => ({}) };
      }),
    );
    const found = await retrieveExemplarsWithEmbed({
      userMessage: "海边",
      records,
      minScore: 0.05,
      personaId: 5,
      userId: 1,
    });
    expect(found.some((item) => item.previousUser.includes("沙滩"))).toBe(true);
  });

  it("falls back to the literal path when the query embed fails", async () => {
    listRecordEmbeddings.mockResolvedValue([
      { recordId: 1, dim: 4, vec: packEmbedding(beach) },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    const found = await retrieveExemplarsWithEmbed({
      userMessage: "海边",
      records,
      minScore: 0.05,
      personaId: 5,
      userId: 1,
    });
    expect(found).toEqual(
      retrieveExemplars({ userMessage: "海边", records, minScore: 0.05 }),
    );
  });
});

describe("probeEmbedStatus", () => {
  it("is no_ollama when the tags request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))));
    expect(await probeEmbedStatus()).toBe("no_ollama");
  });

  it("is no_model when Ollama is up without the embedding model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ models: [{ name: "llama3:latest" }] }),
      })),
    );
    expect(await probeEmbedStatus()).toBe("no_model");
  });

  it("is ready when bge-m3 is listed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ models: [{ name: "bge-m3:latest" }] }),
      })),
    );
    expect(await probeEmbedStatus()).toBe("ready");
  });
});

describe("embedPersonaTurns", () => {
  it("embeds the user burst in front of each of their turns", async () => {
    iterateRecords.mockImplementation(async function* () {
      yield* records;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ embeddings: [beach, dinner] }),
      })),
    );
    const result = await embedPersonaTurns({ personaId: 5, userId: 1 });
    expect(result.embedded).toBe(2);
    expect(upsertRecordEmbedding).toHaveBeenCalledTimes(2);
    expect(upsertRecordEmbedding.mock.calls[0][0].recordId).toBe(1);
    expect(upsertRecordEmbedding.mock.calls[1][0].recordId).toBe(3);
  });

  it("skips bursts that already have a vector", async () => {
    iterateRecords.mockImplementation(async function* () {
      yield* records;
    });
    listEmbeddedRecordIds.mockResolvedValue([1, 3]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await embedPersonaTurns({ personaId: 5, userId: 1 });
    expect(result.embedded).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
