import { describe, expect, it } from "vitest";
import {
  aggregateStances,
  mergeStances,
  mentionedStances,
  normalizeStances,
  stanceRejectedKey,
} from "./stances";

/**
 * Likes and dislikes counted off the fact cards, then confirmed
 * before they speak.
 *
 * One quoted line is noise. Three "讨厌香菜" is a dislike. The
 * prompt only hears about it on the turn that says 香菜.
 */

function card(topic: string, polarity: string, statement: string) {
  return { claim: statement, payload: { topic, polarity } };
}

describe("counting stances off the fact cards", () => {
  it("keeps cilantro as a dislike with three lines and the sea as a like with four, and drops a single mention", () => {
    const cards = [
      ...Array.from({ length: 3 }, () => card("香菜", "dislike", "讨厌香菜")),
      ...Array.from({ length: 4 }, () => card("海", "like", "喜欢海")),
      card("咖啡", "like", "这家咖啡还行"),
    ];
    const stances = aggregateStances(cards);
    expect(stances.map((row) => `${row.topic}:${row.polarity}`).sort()).toEqual([
      "海:like",
      "香菜:dislike",
    ]);
    const cilantro = stances.find((row) => row.topic === "香菜");
    const sea = stances.find((row) => row.topic === "海");
    expect(cilantro?.polarity).toBe("dislike");
    expect(cilantro?.evidence).toHaveLength(3);
    expect(cilantro?.statement).toBe("讨厌香菜");
    expect(cilantro?.verified).toBe(false);
    expect(sea?.polarity).toBe("like");
    expect(sea?.evidence).toHaveLength(4);
    expect(stances.find((row) => row.topic === "咖啡")).toBeUndefined();
  });

  it("keeps both likes and dislikes of the same topic", () => {
    const stances = aggregateStances([
      card("香菜", "dislike", "讨厌香菜"),
      card("香菜", "dislike", "香菜不行"),
      card("香菜", "like", "香菜也好吃"),
      card("香菜", "like", "再来点香菜"),
    ]);
    expect(stances).toHaveLength(2);
    expect(stances.map((row) => row.polarity).sort()).toEqual(["dislike", "like"]);
  });
});

describe("keeping a confirmed stance across a re-run", () => {
  it("keeps the confirmed dislike and does not revive a rejected one", () => {
    const merged = mergeStances(
      [
        {
          id: "keep",
          topic: "香菜",
          polarity: "dislike",
          statement: "讨厌香菜",
          evidence: [{ snippet: "讨厌香菜" }, { snippet: "香菜不行" }],
          source: "auto",
          verified: true,
        },
      ],
      [
        {
          id: "auto-cilantro",
          topic: "香菜",
          polarity: "dislike",
          statement: "香菜真难吃",
          evidence: [{ snippet: "讨厌香菜" }, { snippet: "香菜不行" }, { snippet: "别放香菜" }],
          source: "auto",
          verified: false,
        },
        {
          id: "auto-coffee",
          topic: "咖啡",
          polarity: "like",
          statement: "这家咖啡还行",
          evidence: [{ snippet: "这家咖啡还行" }, { snippet: "再来一杯" }],
          source: "auto",
          verified: false,
        },
      ],
      [stanceRejectedKey("咖啡", "like")],
    );
    expect(merged.map((row) => row.topic)).toEqual(["香菜"]);
    expect(merged[0]?.statement).toBe("讨厌香菜");
    expect(merged[0]?.verified).toBe(true);
  });
});

describe("mentioning a confirmed stance this turn", () => {
  it("returns it only when the current words say the topic", () => {
    const cilantro = {
      id: "s1",
      topic: "香菜",
      polarity: "dislike" as const,
      statement: "讨厌香菜",
      evidence: [],
      source: "auto" as const,
      verified: true,
    };
    expect(mentionedStances([cilantro], ["今晚别放香菜"]).map((row) => row.topic)).toEqual(["香菜"]);
    expect(mentionedStances([cilantro], ["吃饭了吗"])).toEqual([]);
    expect(mentionedStances([{ ...cilantro, verified: false }], ["今晚别放香菜"])).toEqual([]);
    const sea = { ...cilantro, id: "s2", topic: "海", polarity: "like" as const, statement: "喜欢海" };
    expect(mentionedStances([sea], ["我喜欢海"]).map((row) => row.topic)).toEqual(["海"]);
    expect(mentionedStances([sea], ["我在上海"])).toEqual([]);
    expect(mentionedStances([sea], ["海鲜"])).toEqual([]);
  });
});

describe("normalising stored stances", () => {
  it("drops a row without a topic or a polarity", () => {
    const stances = normalizeStances([
      { topic: "香菜", polarity: "dislike", statement: "讨厌香菜", evidence: [], source: "auto", verified: true },
      { topic: "", polarity: "like", statement: "喜欢" },
      { topic: "海", polarity: "unknown", statement: "喜欢海" },
    ]);
    expect(stances).toHaveLength(1);
    expect(stances[0]?.topic).toBe("香菜");
  });
});
