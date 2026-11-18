import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { TrpcContext } from "../_core/context";
import { createCollectedMessages, createPersona, deletePersona } from "../db";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { seedXiaoman } from "../test-fixtures/seed-db";
import { MIN_FINGERPRINT_SAMPLES } from "@shared/style-fingerprint";
import { isTextRecord } from "@shared/records";
import { materialRouter } from "./material";

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
      await deletePersona(personaId, userId);
    }
  });

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
      await deletePersona(personaId, userId);
    }
  });

  it("does not read somebody else's persona", async () => {
    const userId = 9_830_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      await expect(
        materialRouter.createCaller(ctxFor(userId + 1)).report({ personaId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await deletePersona(personaId, userId);
    }
  });
});
