import { describe, expect, it } from "vitest";
import { buildXiaomanRecords, XIAOMAN_TRUTH } from "../test-fixtures/xiaoman";
import { extractClaims, verifyClaims } from "./fact-check";

describe("extractClaims", () => {
  it("pulls a place and an old day out of a statement", () => {
    const claims = extractClaims("上次去拾光咖啡那天你迟到了", "zh");
    expect(claims.some((row) => row.kind === "place" && row.text === "拾光咖啡")).toBe(true);
    expect(claims.some((row) => row.kind === "event" && row.text.includes("上次"))).toBe(true);
  });

  it("does not treat a yes-or-no question as a claim", () => {
    expect(extractClaims("你吃饭了吗", "zh")).toEqual([]);
  });

  it("does not treat a tagged question as a claim", () => {
    expect(extractClaims("我们是不是去过拾光咖啡？", "zh")).toEqual([]);
  });

  /**
   * The mark at the end of the line is what makes it a question.
   *
   * `splitClauses` cuts on the punctuation, so the question mark never
   * reached the clause the extractor looked at — "你昨天去拾光咖啡了？"
   * read as a statement, and the place became a claim the persona then
   * had to have in the record.
   */
  it("does not treat a line that ends in a question mark as a claim", () => {
    expect(extractClaims("你昨天去拾光咖啡了吗？", "zh")).toEqual([]);
    expect(extractClaims("你昨天去拾光咖啡了？", "zh")).toEqual([]);
    expect(extractClaims("你昨天去拾光咖啡了?", "zh")).toEqual([]);
    // Trailing whitespace after the mark does not turn it back into a statement.
    expect(extractClaims("你昨天去拾光咖啡了？  \n", "zh")).toEqual([]);
    // The interrobang is still a question.
    expect(extractClaims("你昨天去拾光咖啡了吗？！", "zh")).toEqual([]);
  });

  it("reads the question mark through the closing quote", () => {
    expect(extractClaims("「你昨天去拾光咖啡了？」", "zh")).toEqual([]);
    expect(extractClaims("你昨天去拾光咖啡了？」", "zh")).toEqual([]);
  });

  it("does not treat an English line ending in a question mark as a claim", () => {
    expect(extractClaims("You went to the Blue Lake Cafe?", "en")).toEqual([]);
    expect(extractClaims("Did you go to the Blue Lake Cafe?", "en")).toEqual([]);
  });

  it("keeps a plain statement a claim", () => {
    expect(extractClaims("你昨天去了拾光咖啡。", "zh")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "place", text: "拾光咖啡" }),
      ]),
    );
  });

  /**
   * A question among statements stops only itself: the rest of the same
   * reply can still name things the record has to hold.
   */
  it("skips the question and keeps the statement after it", () => {
    const claims = extractClaims("你昨天去拾光咖啡了？我去了蓝湖公园。", "zh");
    expect(claims.some((row) => row.text === "拾光咖啡")).toBe(false);
    expect(claims.some((row) => row.kind === "place" && row.text === "蓝湖公园")).toBe(true);
  });

  it("keeps the place name and skips a drink", () => {
    const named = extractClaims("我们去了拾光咖啡", "zh");
    expect(named.some((row) => row.kind === "place" && row.text === "拾光咖啡")).toBe(true);
    expect(named.some((row) => row.text === "我们去了拾光咖啡")).toBe(false);
    expect(extractClaims("我喝咖啡", "zh").filter((row) => row.kind === "place")).toEqual([]);
  });

  it("keeps the English place phrase, not the sentence that led to it", () => {
    const park = extractClaims("She was in the park yesterday.", "en");
    expect(park).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "place", text: "the park" }),
    ]));
    const hospital = extractClaims("He works at the hospital.", "en");
    expect(hospital).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "place", text: "the hospital" }),
    ]));
    const cafe = extractClaims("We went to the Blue Lake Cafe last week.", "en");
    expect(cafe).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "place", text: "the Blue Lake Cafe" }),
    ]));
    expect(cafe.some((row) => row.text === "We went to the Blue Lake Cafe")).toBe(false);
    const generic = extractClaims("We went to that cafe.", "en");
    expect(generic).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "place", text: "that cafe" }),
    ]));
  });

  it("still reads a Chinese place when the interface is English", () => {
    const claims = extractClaims("上次去拾光咖啡那天你迟到了", "en");
    expect(claims.some((row) => row.kind === "place" && row.text === "拾光咖啡")).toBe(true);
  });
});

describe("verifyClaims on the Xiaoman fixture", () => {
  const records = buildXiaomanRecords();
  const cafe = records.find((row) => row.content.includes("拾光咖啡"));

  it("supports 拾光咖啡 from the cafe record, and not 蓝湖餐厅", async () => {
    expect(cafe).toBeTruthy();
    const verified = await verifyClaims(
      [
        { text: "拾光咖啡", kind: "place", start: 0, end: 4 },
        { text: "蓝湖餐厅", kind: "place", start: 0, end: 4 },
      ],
      { personaId: 1, userId: 1, memories: [], records },
    );
    const supported = verified.find((row) => row.text === "拾光咖啡");
    const invented = verified.find((row) => row.text === "蓝湖餐厅");
    expect(supported?.supported).toBe(true);
    expect(supported?.source?.type).toBe("record");
    expect(supported?.source?.id).toBe(cafe!.id);
    expect(invented?.supported).toBe(false);
    expect(invented?.source).toBeUndefined();
  });

  it("prefers a recalled memory when the title covers the claim", async () => {
    const verified = await verifyClaims(
      [{ text: "拾光咖啡", kind: "place", start: 0, end: 4 }],
      {
        personaId: 1,
        userId: 1,
        memories: [
          {
            id: 17,
            title: XIAOMAN_TRUTH.factCafe.text,
            description: null,
            date: XIAOMAN_TRUTH.factCafe.date,
          },
        ],
      },
    );
    expect(verified[0]?.supported).toBe(true);
    expect(verified[0]?.source).toEqual({
      type: "memory",
      id: 17,
      at: XIAOMAN_TRUTH.factCafe.date,
    });
  });

  it("supports a place that is only in the memory description", async () => {
    const claims = extractClaims("我们去了拾光咖啡", "zh");
    const verified = await verifyClaims(claims, {
      personaId: 1,
      userId: 1,
      memories: [{ id: 9, title: "第一次见面", description: "在拾光咖啡", date: "2022-03-12" }],
      records,
    });
    const place = verified.find((row) => row.kind === "place");
    expect(place?.text).toBe("拾光咖啡");
    expect(place?.supported).toBe(true);
    expect(place?.source).toEqual({ type: "memory", id: 9, at: "2022-03-12" });
  });
});
