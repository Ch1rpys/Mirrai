import { describe, expect, it, vi } from "vitest";
import {
  DistillationMapFailed,
  mapObservationCards,
  parseObservationCards,
} from "./observations";
import type { RecordChunk, RecordLine } from "./chunks";

function line(
  id: number,
  role: "user" | "assistant",
  content: string,
): RecordLine {
  return {
    id,
    role,
    content,
    timestamp: new Date("2022-03-01T12:00:00.000Z"),
    kind: "text",
  };
}

function chunkWith(rows: RecordLine[]): RecordChunk {
  return {
    index: 0,
    hash: `h${rows[0]?.id ?? 0}`,
    from: rows[0]?.timestamp ?? null,
    to: rows[rows.length - 1]?.timestamp ?? null,
    periodId: "period-1",
    dayPart: "day",
    chars: rows.reduce((sum, row) => sum + row.content.length, 0),
    rows,
  };
}

const them = line(10, "assistant", "在的呀");
const me = line(11, "user", "今晚见");

describe("parseObservationCards", () => {
  it("drops a card that cites a line that is not in the block", () => {
    const chunk = chunkWith([them, me]);
    const cards = parseObservationCards(
      JSON.stringify({
        observations: [
          { dimension: "care", claim: "约见面", quotes: [999] },
          { dimension: "care", claim: "约今晚", quotes: [11] },
        ],
      }),
      chunk,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].quotes).toEqual([11]);
  });

  it("drops an expression card that only cites the user", () => {
    const chunk = chunkWith([them, me]);
    const cards = parseObservationCards(
      JSON.stringify({
        observations: [
          { dimension: "expression", claim: "用户在约", quotes: [11] },
          { dimension: "expression", claim: "会说在的呀", quotes: [10] },
        ],
      }),
      chunk,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].quotes).toEqual([10]);
  });
});

describe("mapObservationCards", () => {
  it("calls the model once per block in deep mode, and stores empty blocks", async () => {
    const chunks = [chunkWith([them, me]), chunkWith([line(20, "assistant", "晚安")])];
    const invoke = vi.fn(async () =>
      JSON.stringify({ observations: [{ dimension: "habit", claim: "会说晚安", quotes: [20] }] }),
    );
    const saveChunk = vi.fn();
    const saveCard = vi.fn();
    const cards = await mapObservationCards({
      chunks,
      personaId: 1,
      userId: 1,
      name: "小满",
      mode: "deep",
      invoke,
      store: { saveChunk, saveCard },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(saveChunk).toHaveBeenCalledTimes(2);
    // The second block produced a card; the first had quotes that were
    // not in it, so it stored the block and no card.
    expect(saveChunk.mock.calls.map((call) => call[0].cardCount)).toEqual([0, 1]);
    expect(cards).toHaveLength(1);
  });

  it("reads twelve blocks in fast mode when there are more than twelve", async () => {
    const chunks = Array.from({ length: 15 }, (_, i) =>
      chunkWith([line(100 + i, "assistant", `行${i}`)]),
    );
    const invoke = vi.fn(async () =>
      JSON.stringify({ observations: [] }),
    );
    await mapObservationCards({
      chunks,
      personaId: 1,
      userId: 1,
      name: "小满",
      mode: "fast",
      invoke,
      store: { saveChunk: vi.fn(), saveCard: vi.fn() },
    });
    expect(invoke).toHaveBeenCalledTimes(12);
  });

  it("fails the run when more than a third of the blocks throw twice", async () => {
    const chunks = Array.from({ length: 3 }, (_, i) =>
      chunkWith([line(1 + i, "assistant", "在")]),
    );
    const invoke = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(
      mapObservationCards({
        chunks,
        personaId: 1,
        userId: 1,
        name: "小满",
        mode: "deep",
        invoke,
        store: { saveChunk: vi.fn(), saveCard: vi.fn() },
      }),
    ).rejects.toBeInstanceOf(DistillationMapFailed);
    // One try plus one retry, per block.
    expect(invoke).toHaveBeenCalledTimes(6);
  });
});

