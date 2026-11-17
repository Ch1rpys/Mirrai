import { describe, expect, it, vi } from "vitest";
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
