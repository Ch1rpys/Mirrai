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
