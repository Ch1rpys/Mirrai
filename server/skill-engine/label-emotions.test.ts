import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Labelling the emotional state of a scene (B1.5).
 *
 * The rule branch, the write-back and the second-run no-op are the three
 * things the record pools depend on: a state that is decided but never
 * written leaves every per-state bucket empty, and a second run that asks
 * the model again pays for the same answer twice.
 */
const updateRecordLabels = vi.fn();
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateRecordLabels: (...args: unknown[]) => updateRecordLabels(...args),
}));

import { labelEmotionsForRecords } from "./label-emotions";

interface Row {
  id: number;
  role: string;
  content: string;
  kind: "text";
  timestamp: Date;
  emotion?: string | null;
  emotionSource?: string | null;
}

/** One scene inside a two-hour conversation. */
function scene(
  idBase: number,
  at: number,
  lines: Array<{ role: "user" | "assistant"; content: string }>,
): Row[] {
  return lines.map((line, index) => ({
    id: idBase + index,
    role: line.role,
    content: line.content,
    kind: "text",
    timestamp: new Date(at + index * 10_000),
  }));
}

const SAD = ["我今天好难过", "真的难过"];

describe("labelling emotions on a record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateRecordLabels.mockResolvedValue(true);
  });

  function twoScenes(): Row[] {
    // The first scene is decided by the trigger words (two of their lines
    // carry the same state); the second has no trigger at all.
    const first = scene(1, Date.parse("2023-03-01T12:00:00Z"), [
      { role: "user", content: "今天发生了一件事" },
      { role: "assistant", content: SAD[0]! },
      { role: "assistant", content: SAD[1]! },
    ]);
    const second = scene(11, Date.parse("2023-03-05T12:00:00Z"), [
      { role: "user", content: "在吗" },
      { role: "assistant", content: "在的" },
    ]);
    return [...first, ...second];
  }

  it("decides a scene by rule when two of their lines carry the same trigger", async () => {
    const records = twoScenes();
    const result = await labelEmotionsForRecords({
      personaId: 1,
      userId: 1,
      mode: "standard",
      records,
      write: true,
      invoke: vi.fn(async () => JSON.stringify([{ i: 0, state: "melancholy" }])),
    });
    // The rule scene is two of their lines; the model may add the other.
    expect(result.labelled).toBeGreaterThanOrEqual(2);
    const ruleWrites = updateRecordLabels.mock.calls.filter(
      (call) => (call[2] as { emotionSource?: string }).emotionSource === "rule",
    );
    expect(ruleWrites.length).toBeGreaterThanOrEqual(2);
    for (const call of ruleWrites) {
      expect(call[1]).toBe(1);
      expect(call[2]).toMatchObject({ emotion: "melancholy", emotionSource: "rule" });
    }
  });

  it("writes the model's state back to every line in the scene", async () => {
    const records = twoScenes().slice(3);
    await labelEmotionsForRecords({
      personaId: 1,
      userId: 1,
      mode: "standard",
      records,
      write: true,
      invoke: vi.fn(async () => JSON.stringify([{ i: 0, state: "warm" }])),
    });
    expect(updateRecordLabels).toHaveBeenCalledWith(
      expect.any(Number),
      1,
      expect.objectContaining({ emotion: "warm", emotionSource: "model" }),
    );
  });

  it("does not label the same scene twice", async () => {
    const records = twoScenes();
    const invoke = vi.fn(async () => JSON.stringify([{ i: 0, state: "warm" }]));
    await labelEmotionsForRecords({
      personaId: 1, userId: 1, mode: "standard", records, write: true, invoke,
    });
    const calls = invoke.mock.calls.length;
    const writes = updateRecordLabels.mock.calls.length;
    const second = await labelEmotionsForRecords({
      personaId: 1, userId: 1, mode: "standard", records, write: true, invoke,
    });
    expect(invoke.mock.calls.length).toBe(calls);
    expect(updateRecordLabels.mock.calls.length).toBe(writes);
    expect(second.modelled).toBe(0);
  });

  it("leaves a scene undecided rather than defaulting it to warm", async () => {
    const records = scene(1, Date.parse("2023-03-01T12:00:00Z"), [
      { role: "user", content: "在吗" },
      { role: "assistant", content: "在的" },
    ]);
    const result = await labelEmotionsForRecords({
      personaId: 1,
      userId: 1,
      mode: "fast",
      records,
      write: true,
    });
    expect(result.labelled).toBe(0);
    expect(updateRecordLabels).not.toHaveBeenCalled();
  });
});
