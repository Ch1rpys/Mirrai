import { describe, expect, it, vi } from "vitest";
import { countsForCondition } from "@shared/act-profile";
import { buildActProfile } from "./acts";
import { labelEmotionsForRecords } from "./label-emotions";
import { splitScenes } from "@shared/scenes";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { isEmotionalState } from "../_core/emotion";

/**
 * Distillation used to put every act-profile bucket in "warm" because
 * no emotion was ever written on a row. First red on the old path:
 * every bucket's emotion was "warm", so an assertion that a distant
 * bucket exists failed.
 */

function payloadText(req: unknown): string {
  if (typeof req === "string") return req;
  if (Array.isArray(req)) return req.map((item) => payloadText(item)).join("\n");
  if (req && typeof req === "object") {
    const record = req as { content?: unknown; messages?: unknown };
    return [payloadText(record.messages), payloadText(record.content)].join("\n");
  }
  return "";
}

describe("emotion buckets on the act profile", () => {
  it("has a distant bucket after a truth mock labels the fixture", async () => {
    const fixture = buildXiaomanRecords();
    const records = fixture.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      kind: row.kind,
      timestamp: row.timestamp,
      speaker: row.speaker,
      act: row.role === "assistant" ? row.truth.act ?? null : null,
      emotion: null as string | null,
    }));
    const truthByText = new Map<string, string[]>();
    for (const row of fixture) {
      if (row.role !== "assistant" || row.kind !== "text" || !row.truth.state) continue;
      const list = truthByText.get(row.content) ?? [];
      list.push(row.truth.state);
      truthByText.set(row.content, list);
    }
    const invoke = vi.fn(async (messages: Array<{ content?: unknown }>) => {
      const user = messages.find((message) => String(message.content ?? "").includes("MATERIAL>>>"));
      const raw = String(user?.content ?? payloadText(messages));
      const jsonLine = raw.split("\n").find((line) => line.trim().startsWith("["));
      let payload: Array<{ i?: number; text?: string }> = [];
      if (jsonLine) {
        try {
          payload = JSON.parse(jsonLine) as Array<{ i?: number; text?: string }>;
        } catch {
          payload = [];
        }
      }
      return JSON.stringify(
        payload.flatMap((item) => {
          const text = String(item.text ?? "");
          const votes = new Map<string, number>();
          for (const match of text.matchAll(/^them: (.*)$/gm)) {
            const queue = truthByText.get(match[1] ?? "");
            const state = queue && queue.length > 0 ? queue.shift() : null;
            if (state) votes.set(state, (votes.get(state) ?? 0) + 1);
          }
          const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
          const state = ranked[0]?.[0];
          if (!state || !isEmotionalState(state)) return [];
          return [{ i: item.i ?? 0, state }];
        }),
      );
    });
    await labelEmotionsForRecords({
      personaId: 1,
      userId: 1,
      mode: "standard",
      locale: "zh",
      timeZone: "Asia/Shanghai",
      records,
      write: false,
      invoke,
    });

    const distantScenes = splitScenes(fixture).filter((scene) => {
      const states = scene
        .filter((row) => row.role === "assistant" && row.kind === "text")
        .map((row) => row.truth.state);
      return states.length > 0 && states.every((state) => state === "distant");
    });
    expect(distantScenes.length).toBeGreaterThan(0);
    for (const scene of distantScenes) {
      for (const row of scene) {
        const labelled = records.find((item) => item.id === row.id);
        if (row.role === "assistant") {
          expect(labelled?.emotion).toBe("distant");
        } else {
          expect(labelled?.emotion).toBeNull();
        }
      }
    }
    for (const row of records.filter((item) => item.role === "user")) {
      expect(row.emotion).toBeNull();
    }

    const profile = await buildActProfile({
      messages: records,
      userId: 1,
      locale: "zh",
      timezone: "Asia/Shanghai",
      relationshipPhase: "stable",
    });
    const distant = (profile?.buckets ?? []).filter((bucket) => bucket.emotion === "distant");
    expect(distant.length).toBeGreaterThan(0);
    expect(distant.some((bucket) => bucket.samples > 0)).toBe(true);

    const thick = [...distant].sort((a, b) => b.samples - a.samples)[0];
    expect(thick).toBeTruthy();
    const decided = countsForCondition(profile!, {
      asking: thick!.asking ?? false,
      emotion: "distant",
      dayPart: thick!.dayPart ?? "day",
      relationshipPhase: thick!.relationshipPhase ?? "stable",
    });
    expect(decided.fallback).toBe(false);
  });
});

describe("when a scene cannot be labelled", () => {
  it("does not call the model in fast mode, and does not invent a state", async () => {
    const records = [
      {
        id: 1,
        role: "user" as const,
        content: "今天天气不错",
        kind: "text" as const,
        timestamp: new Date("2023-03-01T12:00:00.000Z"),
        emotion: null as string | null,
      },
      {
        id: 2,
        role: "assistant" as const,
        content: "风有点大",
        kind: "text" as const,
        timestamp: new Date("2023-03-01T12:01:00.000Z"),
        emotion: null as string | null,
      },
    ];
    const invoke = vi.fn(async () => "[]");
    const first = await labelEmotionsForRecords({
      personaId: 1,
      userId: 1,
      mode: "fast",
      records,
      write: false,
      invoke,
    });
    expect(first.calls).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
    expect(records[1]?.emotion).toBeNull();
  });

  it("does not call the model a second time on the same scenes", async () => {
    const records = [
      {
        id: 1,
        role: "user" as const,
        content: "今天天气不错",
        kind: "text" as const,
        timestamp: new Date("2023-03-01T12:00:00.000Z"),
        emotion: null as string | null,
      },
      {
        id: 2,
        role: "assistant" as const,
        content: "风有点大",
        kind: "text" as const,
        timestamp: new Date("2023-03-01T12:01:00.000Z"),
        emotion: null as string | null,
      },
    ];
    const invoke = vi.fn(async () => JSON.stringify([{ i: 0, state: "warm" }]));
    const first = await labelEmotionsForRecords({
      personaId: 1,
      userId: 1,
      mode: "deep",
      records,
      write: false,
      invoke,
    });
    expect(first.calls).toBe(1);
    expect(records[1]?.emotion).toBe("warm");
    const before = invoke.mock.calls.length;
    const second = await labelEmotionsForRecords({
      personaId: 1,
      userId: 1,
      mode: "deep",
      records,
      write: false,
      invoke,
    });
    expect(second.calls).toBe(0);
    expect(invoke.mock.calls.length).toBe(before);
  });
});
