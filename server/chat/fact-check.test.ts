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
});
