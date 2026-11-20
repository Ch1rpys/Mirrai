import { describe, expect, it } from "vitest";
import {
  bigramJaccard,
  findNearest,
  normalizeForNearest,
  splitSentences,
} from "./nearest";
import { deletePersona } from "../db";
import { seedXiaoman } from "../test-fixtures/seed-db";

const DATABASE_URL = process.env.DATABASE_URL;

describe("the nearest-line comparison", () => {
  it("splits an input into its sentences", () => {
    expect(splitSentences("晚安。今天好累！你在干嘛？")).toEqual([
      "晚安。",
      "今天好累！",
      "你在干嘛？",
    ]);
    expect(splitSentences("一句没有标点的话").length).toBe(1);
  });

  it("drops punctuation, spaces and case before comparing", () => {
    expect(normalizeForNearest("好啦， 不生气了！")).toBe("好啦不生气了");
    expect(normalizeForNearest("OK！")).toBe("ok");
  });

  it("measures the shared character pairs", () => {
    expect(bigramJaccard("好啦不生气了", "好啦不气了")).toBeGreaterThanOrEqual(0.5);
    expect(bigramJaccard("晚安", "今天天气不错")).toBeLessThan(0.5);
  });
});

describe.skipIf(!DATABASE_URL)("findNearest on the Xiaoman fixture", () => {
  it("says a line was said exactly, a close line was similar, and an unrelated one is absent", async () => {
    const userId = 9_935_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const [goodnight] = await findNearest({ personaId, userId, text: "晚安" });
      expect(goodnight.verdict).toBe("verbatim");
      expect(goodnight.matches[0].content).toBe("晚安");
      expect(goodnight.matches[0].at).not.toBeNull();

      const [similar] = await findNearest({
        personaId,
        userId,
        text: "好啦 不生气了",
      });
      expect(similar.verdict).toBe("similar");
      expect(similar.matches[0].content).toBe("好啦 不气了");

      const [none] = await findNearest({
        personaId,
        userId,
        text: "今天天气不错",
      });
      expect(none.verdict).toBe("none");
      expect(none.matches).toEqual([]);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("gives three verdicts for three sentences", async () => {
    const userId = 9_936_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const result = await findNearest({
        personaId,
        userId,
        text: "晚安。好啦 不生气了。今天天气不错",
      });
      expect(result.map((row) => row.verdict)).toEqual([
        "verbatim",
        "similar",
        "none",
      ]);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("does not call a short line said because another line contains it", async () => {
    const userId = 9_937_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      // "好" alone is not a line in the record, and the rule is that
      // only an exact match counts below four characters.
      const [result] = await findNearest({ personaId, userId, text: "好" });
      expect(result.verdict).not.toBe("verbatim");
    } finally {
      await deletePersona(personaId, userId);
    }
  });
});
