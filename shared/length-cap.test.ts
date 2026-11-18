import { describe, expect, it } from "vitest";
import { capReply, replyBudget } from "./length-cap";
import { measureFingerprint, type FingerprintRow } from "./style-fingerprint";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import type { StyleFingerprint } from "./style-fingerprint";

function fixtureFingerprint(): StyleFingerprint {
  const rows: FingerprintRow[] = buildXiaomanRecords().map((row) => ({
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    emotion: row.truth.state,
    speaker: row.speaker,
  }));
  const fp = measureFingerprint(rows, { addressForms: ["陈树", "树树"] });
  if (!fp) throw new Error("fixture fingerprint missing");
  return fp;
}

describe("replyBudget", () => {
  it("uses ceil(p95 × 1.5) on the fixture fingerprint", () => {
    const fp = fixtureFingerprint();
    const budget = replyBudget(fp, 3);
    expect(budget).not.toBeNull();
    expect(budget!.maxChars).toBe(Math.ceil(fp.turnChars.p95 * 1.5));
    expect(budget!.maxTokens).toBe(Math.ceil(budget!.maxChars * 2));
    expect(budget!.maxChars).toBeGreaterThanOrEqual(12);
    expect(budget!.stop).toBeUndefined();
  });

  it("returns null when there is no fingerprint", () => {
    expect(replyBudget(null, 1)).toBeNull();
  });

  it("uses the user's maxTokens when it is smaller", () => {
    const fp = fixtureFingerprint();
    const natural = replyBudget(fp, 3);
    expect(natural).not.toBeNull();
    const tighter = Math.max(1, natural!.maxTokens - 10);
    const budget = replyBudget(fp, 3, { userMaxTokens: tighter });
    expect(budget!.maxTokens).toBe(tighter);
    expect(budget!.maxChars).toBe(natural!.maxChars);
  });

  it("stops on a newline when they never burst and almost never break a line", () => {
    const fp = fixtureFingerprint();
    const budget = replyBudget(fp, 1, { newlineRate: 0.01 });
    expect(budget!.stop).toEqual(["\n"]);
  });
});

describe("capReply", () => {
  it("cuts a 200-character reply on a sentence boundary at maxChars 30", () => {
    const head = "第一句在这里。";
    const text = head + "啊".repeat(193);
    expect(Array.from(text).length).toBe(200);
    const capped = capReply(text, 30);
    expect(capped.capped).toBe(true);
    expect(capped.text).toBe(head);
    expect(Array.from(capped.text).length).toBeLessThanOrEqual(30);
  });

  it("hard-cuts at exactly 30 characters when there is no boundary", () => {
    const text = "啊".repeat(200);
    const capped = capReply(text, 30);
    expect(capped.capped).toBe(true);
    expect(capped.text).toBe("啊".repeat(30));
    expect(Array.from(capped.text).length).toBe(30);
  });

  it("leaves a short reply alone", () => {
    expect(capReply("在的呀", 30)).toEqual({ text: "在的呀", capped: false });
  });
});
