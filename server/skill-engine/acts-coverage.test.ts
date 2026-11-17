import { describe, expect, it, vi } from "vitest";
import { buildActProfile } from "./acts";
import { labelActsForRecords } from "./label-acts";
import {
  buildXiaomanRecords,
  XIAOMAN_TRUTH,
} from "../test-fixtures/xiaoman";

/**
 * Distillation used to send only the first eighty unlabelled replies
 * to the model. Everything after that never entered the distribution.
 *
 * First red on the old path: `expected 80 to be greater than 200`.
 */

function unlabeledRounds(count: number) {
  const records: Array<{
    id: number;
    role: string;
    content: string;
    kind: "text";
    timestamp: Date;
    act?: string | null;
  }> = [];
  const start = Date.parse("2023-03-01T12:00:00.000Z");
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

describe("how many replies enter the act distribution", () => {
  it("puts all three hundred unlabelled replies into the counts in standard mode", async () => {
    const records = unlabeledRounds(300);
    const invoke = vi.fn(async (messages: unknown) => labelsFrom(messages));
    await labelActsForRecords({
      personaId: 1,
      userId: 1,
      mode: "standard",
      locale: "zh",
      records,
      write: false,
      invoke,
    });
    const profile = await buildActProfile({
      messages: records,
      userId: 1,
      locale: "zh",
    });
    expect(profile?.samples).toBeGreaterThan(200);
    expect(profile?.samples).toBe(300);
    expect(invoke.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("the fixture's p2 acknowledgements", () => {
  it("lands within five points of the designed share after a truth mock", async () => {
    const fixture = buildXiaomanRecords().filter((row) => row.truth.period === "p2");
    const records = fixture.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      kind: row.kind,
      timestamp: row.timestamp,
      speaker: row.speaker,
      act: null as string | null,
    }));
    const truthByText = new Map<string, string[]>();
    for (const row of fixture) {
      if (row.role !== "assistant" || row.kind !== "text" || !row.truth.act) continue;
      const list = truthByText.get(row.content) ?? [];
      list.push(row.truth.act);
      truthByText.set(row.content, list);
    }
    const invoke = vi.fn(async (messages: Array<{ content?: unknown }>) => {
      const user = messages.find((message) => String(message.content ?? "").includes('"prev"'));
      const raw = String(user?.content ?? "");
      const items = [...raw.matchAll(/"i":\s*(\d+),"prev":"[^"]*","text":"([^"]*)"/g)];
      // The payload is JSON inside a fence; parse the array if we can.
      const start = raw.indexOf("[");
      const end = raw.lastIndexOf("]");
      let payload: Array<{ i?: number; text?: string }> = [];
      if (start >= 0 && end > start) {
        try {
          payload = JSON.parse(raw.slice(start, end + 1)) as Array<{ i?: number; text?: string }>;
        } catch {
          payload = items.map((match) => ({ i: Number(match[1]), text: match[2] }));
        }
      }
      return JSON.stringify(
        payload.map((item) => {
          const text = String(item.text ?? "");
          const queue = truthByText.get(text);
          const act = queue && queue.length > 0 ? queue.shift() : "answer";
          return { i: item.i ?? 0, act, prevAct: "other" };
        }),
      );
    });
    await labelActsForRecords({
      personaId: 1,
      userId: 1,
      mode: "standard",
      locale: "zh",
      timeZone: "Asia/Shanghai",
      records,
      write: false,
      invoke,
    });
    const profile = await buildActProfile({
      messages: records,
      userId: 1,
      locale: "zh",
      timezone: "Asia/Shanghai",
    });
    expect(profile).toBeTruthy();
    const samples = profile!.samples;
    const ack = profile!.unconditional.acknowledge ?? 0;
    expect(Math.abs(ack / samples - XIAOMAN_TRUTH.acknowledgeP2)).toBeLessThanOrEqual(0.05);
  });
});
