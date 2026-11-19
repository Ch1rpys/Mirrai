import { describe, expect, it } from "vitest";
import { seededRandom } from "../server/_core/behavior-profile";
import {
  detectReanchor,
  pickStyleReminderLines,
  styleReminderSeed,
} from "./style-reminder";
import { measureFingerprint } from "./style-fingerprint";

function numbered(prefix: string, n: number, suffix = ""): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}${suffix}`);
}

describe("pickStyleReminderLines", () => {
  it("prefers the current mood and stays stable inside a batch of six", () => {
    const distant = numbered("远", 40, "。");
    const warm = numbered("暖", 40, "呀");
    const pool = { distant, warm, any: [...distant, ...warm] };
    const first = pickStyleReminderLines({
      pool,
      state: "distant",
      rng: seededRandom(styleReminderSeed(1, 0)),
    });
    const fifth = pickStyleReminderLines({
      pool,
      state: "distant",
      rng: seededRandom(styleReminderSeed(1, 5)),
    });
    const sixth = pickStyleReminderLines({
      pool,
      state: "distant",
      rng: seededRandom(styleReminderSeed(1, 6)),
    });
    expect(first).toHaveLength(6);
    expect(first.every((line) => distant.includes(line))).toBe(true);
    expect(fifth).toEqual(first);
    expect(sixth).not.toEqual(first);
    expect(styleReminderSeed(1, 0)).toBe(styleReminderSeed(1, 5));
    expect(styleReminderSeed(1, 6)).not.toBe(styleReminderSeed(1, 0));
  });

  it("skips lines that already sit in the seed turns", () => {
    const picked = pickStyleReminderLines({
      pool: { any: ["甲", "乙", "丙", "丁", "戊", "己", "庚"] },
      rng: () => 0,
      skip: ["甲", "乙"],
    });
    expect(picked).not.toContain("甲");
    expect(picked).not.toContain("乙");
  });
});

describe("detectReanchor", () => {
  const fp = measureFingerprint(
    Array.from({ length: 40 }, () => ({
      role: "assistant",
      content: "在的呀",
      kind: "text",
    })),
  );

  it("fires on eight long questions and stays quiet on their own lines", () => {
    expect(fp).toBeTruthy();
    const longQuestion = "这是一句很长很长很长很长很长很长的问句对不对？";
    const drifted = detectReanchor({
      history: Array.from({ length: 8 }, () => ({ role: "assistant", content: longQuestion })),
      fingerprint: fp,
      core: fp,
    });
    expect(drifted).not.toBeNull();
    expect(drifted?.issues).toEqual(expect.arrayContaining(["long", "question"]));
    const own = detectReanchor({
      history: Array.from({ length: 8 }, () => ({ role: "assistant", content: "在的呀" })),
      fingerprint: fp,
      core: fp,
    });
    expect(own).toBeNull();
  });

  it("fires when the residue is high but each tell is spread across fewer than half the lines", () => {
    const spread = measureFingerprint(
      Array.from({ length: 40 }, () => ({
        role: "assistant",
        content: "一二三四五六七八九",
        kind: "text",
      })),
    );
    expect(spread).toBeTruthy();
    const mixed = detectReanchor({
      history: [
        ...Array.from({ length: 3 }, () => ({
          role: "assistant",
          content: "这是一句很长很长很长很长的问句吗？",
        })),
        ...Array.from({ length: 2 }, () => ({
          role: "assistant",
          content: "我理解你\n1. 好",
        })),
        ...Array.from({ length: 3 }, () => ({ role: "assistant", content: "在的呀" })),
      ],
      fingerprint: spread,
      core: spread,
    });
    expect(mixed).not.toBeNull();
    expect(mixed?.issues).toEqual(expect.arrayContaining(["long", "question", "cliche"]));
  });

  it("does not fire with fewer than eight assistant lines", () => {
    const longQuestion = "这是一句很长很长很长很长很长很长的问句对不对？";
    expect(
      detectReanchor({
        history: Array.from({ length: 7 }, () => ({ role: "assistant", content: longQuestion })),
        fingerprint: fp,
        core: fp,
      }),
    ).toBeNull();
  });
});
