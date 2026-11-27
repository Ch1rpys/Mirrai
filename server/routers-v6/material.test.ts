import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { TrpcContext } from "../_core/context";
import { createCollectedMessages, createPersona, purgePersona, setPersonaStyleProfile } from "../db";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { seedXiaoman } from "../test-fixtures/seed-db";
import { MIN_FINGERPRINT_SAMPLES, measureFingerprint } from "@shared/style-fingerprint";
import { isTextRecord } from "@shared/records";
import { materialRouter, ritualHaveFromStyleProfile } from "./material";

const DATABASE_URL = process.env.DATABASE_URL;

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: `User ${userId}`,
      timezone: null,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

function hashKey(key: string): string {
  return createHash("md5").update(key).digest("hex");
}

describe.skipIf(!DATABASE_URL)("the material report", () => {
  it("counts their lines on the fixture, and finds the silence between periods", async () => {
    const userId = 9_810_000 + Math.floor(Math.random() * 10_000);
    const expectedTheirs = buildXiaomanRecords().filter((row) => row.role === "assistant").length;
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const report = await materialRouter.createCaller(ctxFor(userId)).report({
        personaId,
      });
      expect(report.theirs).toBe(expectedTheirs);
      const periods = report.layers.find((row) => row.id === "periods");
      expect(periods?.ok).toBe(true);
      expect(periods?.need).toBeGreaterThan(0);
    } finally {
      await purgePersona(personaId, userId);
    }
  }, 15_000);

  it("says the fingerprint is short when only the first thirty lines are kept", async () => {
    const userId = 9_820_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "short" });
    const firstThirty = buildXiaomanRecords()
      .filter((row) => row.role === "user" || row.role === "assistant")
      .slice(0, 30);
    const seen = new Map<string, number>();
    const rows = firstThirty.map((row) => {
      const base = `generic|${row.timestamp.toISOString()}|${row.content}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const key = n === 0 ? base : `${base}|#${n}`;
      return {
        userId,
        personaId,
        source: "generic",
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        kind: row.kind,
        speaker: row.speaker,
        idempotencyKey: hashKey(key),
      };
    });
    await createCollectedMessages(rows);
    try {
      const report = await materialRouter.createCaller(ctxFor(userId)).report({
        personaId,
      });
      const have = firstThirty.filter(
        (row) => row.role === "assistant" && isTextRecord(row),
      ).length;
      const fingerprint = report.layers.find((row) => row.id === "fingerprint");
      expect(fingerprint?.ok).toBe(false);
      expect(fingerprint?.have).toBe(have);
      expect(fingerprint?.need).toBe(MIN_FINGERPRINT_SAMPLES);
      expect(fingerprint!.need - fingerprint!.have).toBe(MIN_FINGERPRINT_SAMPLES - have);
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("counts only their text lines in the per-state statistics", async () => {
    const userId = 9_840_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "states" });
    const rows: Array<{
      userId: number;
      personaId: number;
      source: string;
      role: string;
      content: string;
      timestamp: Date;
      kind: string;
      emotion: string | null;
      idempotencyKey: string;
    }> = [];
    let n = 0;
    const push = (kind: string, emotion: string | null, content: string) => {
      n += 1;
      rows.push({
        userId,
        personaId,
        source: "generic",
        role: "assistant",
        content,
        timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, n)),
        kind,
        emotion,
        idempotencyKey: hashKey(`states|${n}`),
      });
    };
    // Forty text lines, so the fingerprint itself is measurable.
    for (let i = 0; i < 20; i += 1) push("text", "warm", `今天还好，第${i}次。`);
    for (let i = 0; i < 20; i += 1) push("text", null, `没有标注的第${i}句。`);
    /**
     * Stickers wear the other five states. They are not text, so
     * `measureFingerprint` never measures them — the report must not
     * count them as evidence that those states can be measured.
     */
    for (const state of ["playful", "nostalgic", "melancholy", "happy", "distant"]) {
      for (let i = 0; i < 20; i += 1) push("sticker", state, `[sticker:${state}-${i}]`);
    }
    await createCollectedMessages(rows);
    try {
      const report = await materialRouter.createCaller(ctxFor(userId)).report({
        personaId,
      });
      // Only warm has text lines, so warm is the only state that exists.
      expect(report.byEmotion).toEqual({ warm: 20 });
      const perState = report.layers.find((row) => row.id === "perState");
      expect(perState?.have).toBe(0);
      expect(perState?.ok).toBe(false);
      // The report and the measurement must agree about what is there.
      const textRows = rows.filter((row) => row.kind === "text");
      const fingerprint = measureFingerprint(textRows);
      expect(Object.keys(fingerprint?.perState ?? {})).toEqual(["warm"]);
    } finally {
      await purgePersona(personaId, userId);
    }
  }, 15_000);

  it("does not read somebody else's persona", async () => {
    const userId = 9_830_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      await expect(
        materialRouter.createCaller(ctxFor(userId + 1)).report({ personaId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await purgePersona(personaId, userId);
    }
  });
});

describe("the measured ritual layer", () => {
  it("reads the fixed-reply count from the measured ritual table", () => {
    const profile = (n: number) => ({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "1:1",
      rituals: [{
        trigger: "晚安",
        variants: ["晚安"],
        n,
        replies: [{ text: "晚安", n, recordId: 1 }],
        coverage: 1,
      }],
    });
    expect(ritualHaveFromStyleProfile(profile(5))).toBe(5);
    expect(ritualHaveFromStyleProfile(profile(12))).toBe(12);
    expect(ritualHaveFromStyleProfile(null)).toBe(0);
  });
});
