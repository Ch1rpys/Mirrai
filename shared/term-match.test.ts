import { describe, expect, it } from "vitest";
import { containsTerm } from "./term-match";

describe("finding a name or a topic in a line", () => {
  it("matches a two-character name, and not a one-character alias glued into another word", () => {
    expect(containsTerm("阿强来了", "阿强")).toBe(true);
    expect(containsTerm("今天好坚强", "强")).toBe(false);
    expect(containsTerm("强来了", "强")).toBe(true);
  });

  it("matches 海 when it is the sea, and not when it is part of 上海 or 海鲜", () => {
    expect(containsTerm("我喜欢海", "海")).toBe(true);
    expect(containsTerm("看海", "海")).toBe(true);
    expect(containsTerm("我在上海", "海")).toBe(false);
    expect(containsTerm("海鲜", "海")).toBe(false);
    expect(containsTerm("今晚别放香菜", "香菜")).toBe(true);
  });

  it("does not count a degree word or a name suffix as the person or the topic", () => {
    expect(containsTerm("他好强", "强")).toBe(false);
    expect(containsTerm("他很强", "强")).toBe(false);
    expect(containsTerm("争强好胜", "强")).toBe(false);
    expect(containsTerm("他是个海王", "海")).toBe(false);
    expect(containsTerm("读海子的诗", "海")).toBe(false);
  });

  it("still finds the character when it is a word of its own", () => {
    expect(containsTerm("强说了一句", "强")).toBe(true);
    expect(containsTerm("海的颜色", "海")).toBe(true);
  });
});
