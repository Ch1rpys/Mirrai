import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import {
  aggregatePeople,
  mergePeople,
  mergePersonEntries,
  namesMatch,
  normalizePeople,
  mentionedPeople,
  renderPeopleSection,
  peopleRejectedKey,
} from "./people";
import { copy } from "./copy";

/**
 * People counted off the records, then confirmed before they speak.
 *
 * A name that shows up twice is noise. Twelve mentions of 琪琪 is a
 * roommate. The prompt only hears about her on the turn that says
 * her name.
 */

function card(name: string, relation: string, side = "them") {
  return { claim: name, payload: { relation, side } };
}

describe("matching two names for the same person", () => {
  it("treats a prefixed name as the same person", () => {
    expect(namesMatch("阿强", "强")).toBe(true);
    expect(namesMatch("小琪", "琪")).toBe(true);
    expect(namesMatch("我妈", "妈妈")).toBe(false);
    expect(namesMatch("琪琪", "我妈")).toBe(false);
  });
});

describe("counting the people in the records", () => {
  it("keeps 琪琪 and 我妈 from the fixture, at about 12 and 9, and drops a name that appears twice", () => {
    const extra = [
      { content: "路过的人来了", kind: "text" as const, timestamp: new Date("2022-01-01T04:00:00.000Z") },
      { content: "路过的人走了", kind: "text" as const, timestamp: new Date("2022-01-02T04:00:00.000Z") },
    ];
    const people = aggregatePeople(
      [card("琪琪", "室友"), card("我妈", "妈妈"), card("路过的人", "同学")],
      [...buildXiaomanRecords(), ...extra],
    );
    expect(people.map((row) => row.name).sort()).toEqual(["我妈", "琪琪"]);
    const qiqi = people.find((row) => row.name === "琪琪");
    const mom = people.find((row) => row.name === "我妈");
    expect(qiqi?.mentions).toBe(12);
    expect(qiqi?.relation).toBe("室友");
    expect(qiqi?.verified).toBe(false);
    expect(qiqi?.evidence[0]?.snippet).toContain("琪琪");
    expect(mom?.mentions).toBe(9);
    expect(mom?.relation).toBe("妈妈");
    expect(people.find((row) => row.name === "路过的人")).toBeUndefined();
  });

  it("folds 阿强 and 强 into one person", () => {
    const rows = [
      { content: "阿强来了", kind: "text" as const, timestamp: new Date("2022-01-01T00:00:00.000Z") },
      { content: "阿强走了", kind: "text" as const, timestamp: new Date("2022-01-02T00:00:00.000Z") },
      { content: "强打电话", kind: "text" as const, timestamp: new Date("2022-01-03T00:00:00.000Z") },
    ];
    const people = aggregatePeople([card("阿强", "同事"), card("强", "同事")], rows);
    expect(people).toHaveLength(1);
    expect(people[0]?.name).toBe("阿强");
    expect(people[0]?.aliases).toContain("强");
    expect(people[0]?.mentions).toBe(3);
  });
});

describe("normalising stored people", () => {
  it("drops a nameless row and clips the relation", () => {
    const people = normalizePeople([
      { name: "琪琪", relation: "室友室友室友室友室友室友室友", side: "them", mentions: 12, aliases: [], evidence: [], source: "auto", verified: true },
      { name: "", relation: "同学" },
      { relation: "同事" },
    ]);
    expect(people).toHaveLength(1);
    expect(people[0]?.name).toBe("琪琪");
    expect(people[0]?.relation.length).toBeLessThanOrEqual(20);
    expect(people[0]?.verified).toBe(true);
  });
});

describe("keeping a confirmed person across a re-run", () => {
  it("keeps the confirmed roommate and does not revive a rejected name", () => {
    const merged = mergePeople(
      [
        {
          id: "keep",
          name: "琪琪",
          aliases: [],
          relation: "室友",
          side: "them",
          mentions: 12,
          evidence: [{ snippet: "琪琪今天也在" }],
          source: "auto",
          verified: true,
        },
      ],
      [
        {
          id: "auto-qiqi",
          name: "琪琪",
          aliases: [],
          relation: "同事",
          side: "them",
          mentions: 13,
          evidence: [],
          source: "auto",
          verified: false,
        },
        {
          id: "auto-stranger",
          name: "路过的人",
          aliases: [],
          relation: "同学",
          side: "them",
          mentions: 8,
          evidence: [],
          source: "auto",
          verified: false,
        },
      ],
      [peopleRejectedKey("路过的人")],
    );
    expect(merged.map((row) => row.name)).toEqual(["琪琪"]);
    expect(merged[0]?.relation).toBe("室友");
    expect(merged[0]?.verified).toBe(true);
  });
});

describe("mentioning a confirmed person this turn", () => {
  it("returns them only when the current words say their name", () => {
    const qiqi = {
      id: "p1",
      name: "琪琪",
      aliases: [],
      relation: "室友",
      side: "them" as const,
      mentions: 12,
      evidence: [],
      source: "auto" as const,
      verified: true,
    };
    expect(mentionedPeople([qiqi], ["琪琪来了吗"]).map((row) => row.name)).toEqual(["琪琪"]);
    expect(mentionedPeople([qiqi], ["吃饭了吗"])).toEqual([]);
    expect(mentionedPeople([{ ...qiqi, verified: false }], ["琪琪来了吗"])).toEqual([]);
    const qiang = {
      ...qiqi,
      id: "p2",
      name: "阿强",
      aliases: ["强"],
      relation: "同学",
    };
    expect(mentionedPeople([qiang], ["阿强来了"]).map((row) => row.name)).toEqual(["阿强"]);
    expect(mentionedPeople([qiang], ["今天好坚强"])).toEqual([]);
  });

  it("renders the fenced heading the prompt uses", () => {
    const section = renderPeopleSection(
      [{
        id: "p1",
        name: "琪琪",
        aliases: [],
        relation: "室友",
        side: "them",
        mentions: 12,
        evidence: [],
        source: "auto",
        verified: true,
      }],
      "zh",
    );
    expect(section).toContain(copy("zh", "prompt.peopleHeading"));
    expect(section).toContain(copy("zh", "prompt.peopleLine", { name: "琪琪", relation: "室友" }));
  });
});

describe("merging two people the user says are the same", () => {
  it("turns the absorbed name into an alias", () => {
    const people = mergePersonEntries(
      [
        { id: "a", name: "琪琪", aliases: [], relation: "室友", side: "them", mentions: 12, evidence: [], source: "auto", verified: true },
        { id: "b", name: "小琪", aliases: ["琪"], relation: "", side: "them", mentions: 4, evidence: [], source: "auto", verified: false },
      ],
      "b",
      "a",
    );
    expect(people).toHaveLength(1);
    expect(people[0]?.name).toBe("琪琪");
    expect(people[0]?.aliases).toEqual(expect.arrayContaining(["小琪", "琪"]));
    expect(people[0]?.mentions).toBe(16);
  });
});
