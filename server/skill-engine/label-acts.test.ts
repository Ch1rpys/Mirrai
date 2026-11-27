import { describe, expect, it, vi } from "vitest";

const updateRecordLabels = vi.fn();
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateRecordLabels: (...args: unknown[]) => updateRecordLabels(...args),
}));

import { labelActsForRecords } from "./label-acts";

function rounds(count: number, start = Date.parse("2023-03-01T12:00:00.000Z")) {
  const records: Array<{
    id: number;
    role: string;
    content: string;
    kind: "text";
    timestamp: Date;
    act?: string | null;
    actSource?: string | null;
  }> = [];
  for (let i = 0; i < count; i++) {
    records.push({
      id: i * 2 + 1,
      role: "user",
      content: "今天天气不错",
      kind: "text",
      timestamp: new Date(start + i * 120_000),
    });
    records.push({
      id: i * 2 + 2,
      role: "assistant",
      content: `风有点大 ${i}`,
      kind: "text",
      timestamp: new Date(start + i * 120_000 + 30_000),
    });
  }
  return records;
}

function payloadText(req: unknown): string {
  if (typeof req === "string") return req;
  if (Array.isArray(req)) return req.map((item) => payloadText(item)).join("\n");
  if (req && typeof req === "object") {
    const record = req as { content?: unknown; messages?: unknown };
    return [payloadText(record.messages), payloadText(record.content)].join("\n");
  }
  return "";
}

function labelsFrom(req: unknown): string {
  const blob = payloadText(req);
  const indices = [...blob.matchAll(/"i":\s*(\d+)/g)].map((match) => Number(match[1]));
  const max = indices.length ? Math.max(...indices) : -1;
  return JSON.stringify(
    Array.from({ length: max + 1 }, (_, i) => ({ i, act: "answer", prevAct: "other" })),
  );
}

describe("labelling acts on a record", () => {
  it("does not call the model a second time on the same rows", async () => {
    const records = rounds(90);
    const invoke = vi.fn(async (messages: unknown) => labelsFrom(messages));
    const first = await labelActsForRecords({
      personaId: 1,
      userId: 1,
      mode: "standard",
      records,
      write: false,
      invoke,
    });
    expect(first.calls).toBeGreaterThan(0);
    expect(records.filter((row) => row.role === "assistant" && row.act === "answer")).toHaveLength(90);
    const before = invoke.mock.calls.length;
    const second = await labelActsForRecords({
      personaId: 1,
      userId: 1,
      mode: "standard",
      records,
      write: false,
      invoke,
    });
    expect(second.calls).toBe(0);
    expect(invoke.mock.calls.length).toBe(before);
  });

  it("writes every label back to the record row (B1.4)", async () => {
    // The write path had no test at all: every direct test ran with
    // `write: false`, so "the label is on the row" was only ever shown
    // for an in-memory array. The distillation calls this with
    // `write: true`, and that is the path the per-state pools and the
    // act profile read afterwards.
    updateRecordLabels.mockReset();
    updateRecordLabels.mockResolvedValue(true);
    const records = rounds(2);
    await labelActsForRecords({
      personaId: 1,
      userId: 1,
      mode: "standard",
      records,
      write: true,
      invoke: vi.fn(async (messages: unknown) => labelsFrom(messages)),
    });
    const assistantIds = records.filter((row) => row.role === "assistant").map((row) => row.id);
    const userIds = new Set(records.filter((row) => row.role === "user").map((row) => row.id));
    const writtenIds = updateRecordLabels.mock.calls.map((call) => call[0] as number);
    const allIds = new Set(records.map((row) => row.id));
    for (const id of assistantIds) expect(writtenIds).toContain(id);
    // Both sides can carry an act label (the user's actions are read by
    // B4.1), but nothing outside the record batch is written.
    for (const id of writtenIds) expect(allIds.has(id)).toBe(true);
    for (const call of updateRecordLabels.mock.calls) {
      expect(call[1]).toBe(1);
      expect(call[2]).toMatchObject({ act: expect.any(String) });
    }
    expect(updateRecordLabels.mock.calls.some(
      (call) => (call[2] as { actSource?: string }).actSource === "model",
    )).toBe(true);
  });

  it("fences the pair payload", async () => {
    const records = rounds(1);
    const invoke = vi.fn(async (messages: Array<{ content?: unknown }>) => {
      const user = String(messages.find((message) => message.content)?.content ?? "");
      expect(user).toContain("风有点大");
      expect(user).toContain("<<<MATERIAL");
      const stripped = user.replace(/<<<MATERIAL[\s\S]*<<<END MATERIAL>>>:[0-9a-f]+/, "");
      expect(stripped).not.toContain("风有点大");
      return labelsFrom(messages);
    });
    await labelActsForRecords({
      personaId: 1,
      userId: 1,
      mode: "standard",
      records,
      write: false,
      invoke,
    });
    expect(invoke).toHaveBeenCalled();
  });
});
