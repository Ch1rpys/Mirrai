import { describe, expect, it } from "vitest";
import {
  peopleEntitiesInText,
  sanitizeEntities,
} from "./memory-entities";

describe("sanitizeEntities", () => {
  it("keeps an entity that is in the cited line, and drops one that is not", () => {
    const entities = sanitizeEntities(
      { people: ["琪琪"], places: ["拾光咖啡", "蓝湖餐厅"], things: ["橘猫"] },
      "第一次约会在拾光咖啡，琪琪也在",
    );
    expect(entities.people).toEqual(["琪琪"]);
    expect(entities.places).toEqual(["拾光咖啡"]);
    expect(entities.things).toEqual([]);
  });
});

describe("peopleEntitiesInText", () => {
  it("fills confirmed names that appear in the title", () => {
    const people = peopleEntitiesInText("和琪琪去了海边", [
      {
        id: "p1",
        name: "琪琪",
        aliases: ["室友"],
        relation: "室友",
        side: "them",
        mentions: 12,
        evidence: [],
        source: "auto",
        verified: true,
      },
      {
        id: "p2",
        name: "路过的人",
        aliases: [],
        relation: "",
        side: "them",
        mentions: 2,
        evidence: [],
        source: "auto",
        verified: false,
      },
    ]);
    expect(people).toEqual(["琪琪"]);
  });

  it("does not match a one-character alias inside an ordinary word (B6.7)", () => {
    // 「小」 as a nickname must not turn every 「小米粥」 into a memory
    // about that person; the router's auto-fill used a plain substring
    // test while the distilled cards already used the term matcher.
    const people = peopleEntitiesInText("小米粥很好吃，改天再煮", [
      {
        id: "p1",
        name: "小满",
        aliases: ["小"],
        relation: "",
        side: "them",
        mentions: 9,
        evidence: [],
        source: "manual",
        verified: true,
      },
    ]);
    expect(people).toEqual([]);
  });
});
