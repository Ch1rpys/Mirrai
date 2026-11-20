import { describe, expect, it } from "vitest";
import { retrieveExemplars, truncateExemplar } from "./exemplars";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";

// i18n:allow-identifier — fixture lines, not copy the app writes.

const records = [
  { id: 1, role: "user", content: "今晚吃什么" },
  { id: 2, role: "assistant", content: "随便，你定" },
  { id: 3, role: "user", content: "那家店叫什么来着" },
  { id: 4, role: "assistant", content: "老地方那家面" },
  { id: 5, role: "user", content: "你好吗" },
  { id: 6, role: "assistant", content: "还行" },
];

function xiaomanRows() {
  return buildXiaomanRecords().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    speaker: row.speaker,
    act: row.truth.act ?? null,
    emotion: row.truth.state,
  }));
}

describe("retrieving past replies", () => {
  it("returns nothing when nothing is close enough", () => {
    const found = retrieveExemplars({
      userMessage: "quantum chromodynamics",
      records,
      minScore: 0.4,
    });
    expect(found).toEqual([]);
  });

  it("finds the reply that followed a similar user line", () => {
    const found = retrieveExemplars({
      userMessage: "那家店叫什么",
      records,
      minScore: 0.05,
    });
    expect(found.some((item) => item.content.includes("老地方"))).toBe(true);
  });

  it("never uses a public post as a one-to-one exemplar", () => {
    const mixed = [
      { id: 1, role: "user", content: "那家店叫什么" },
      {
        id: 2,
        role: "assistant",
        content: "公开动态：老地方那家面",
        meta: { register: "public" },
      },
      { id: 3, role: "user", content: "那家店叫什么" },
      { id: 4, role: "assistant", content: "老地方那家面", meta: { register: "private" } },
    ];
    const found = retrieveExemplars({
      userMessage: "那家店叫什么",
      records: mixed,
      minScore: 0,
    });
    expect(found.some((item) => item.id === 2)).toBe(false);
    expect(found.some((item) => item.id === 4)).toBe(true);
  });

  it("excludes a held-out id", () => {
    const found = retrieveExemplars({
      userMessage: "那家店叫什么",
      records,
      excludeIds: [4],
      minScore: 0.05,
    });
    expect(found.every((item) => item.id !== 4)).toBe(true);
  });

  it("cuts a line to one and a half of their median", () => {
    expect(truncateExemplar("abcdefghij", 4).length).toBeLessThanOrEqual(6);
  });

  it("does not retrieve a line the harm report filtered out", () => {
    const found = retrieveExemplars({
      userMessage: "今晚吃什么",
      records: [
        { id: 1, role: "user", content: "今晚吃什么" },
        { id: 2, role: "assistant", content: "你就是个废物" },
      ],
      minScore: 0.05,
      personaData: {
        harmReport: {
          categories: [{ kind: "belittle", count: 1, examples: [2] }],
          decision: "pending",
        },
      },
    });
    expect(found.every((item) => !item.content.includes("废物"))).toBe(true);
  });

  it("does not retrieve a sticker as a past reply", () => {
    const found = retrieveExemplars({
      userMessage: "今晚吃什么",
      records: [
        ...records,
        { id: 7, role: "user", content: "今晚吃什么", kind: "text" },
        { id: 8, role: "assistant", content: "[sticker:狗狗探头]", kind: "sticker" },
      ],
      minScore: 0.05,
    });
    expect(found.every((item) => !item.content.startsWith("[sticker:"))).toBe(true);
  });

  it("returns goodnight turns when the current message is 晚安", () => {
    const found = retrieveExemplars({
      userMessage: "晚安",
      records: xiaomanRows(),
    });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((item) => item.previousUser === "晚安")).toBe(true);
    expect(
      found.every((item) => item.turn.every((line) => ["晚安", "安", "睡啦"].includes(line))),
    ).toBe(true);
  });

  it("returns nothing when the first term is below the floor", () => {
    const found = retrieveExemplars({
      userMessage: "quantum chromodynamics",
      records: xiaomanRows(),
    });
    expect(found).toEqual([]);
  });

  it("ranks a tease turn first when the sampled act is tease and the literal scores match", () => {
    const found = retrieveExemplars({
      userMessage: "你好吗",
      sampledAct: "tease",
      records: [
        { id: 1, role: "user", content: "你好吗" },
        { id: 2, role: "assistant", content: "还行", act: "acknowledge" },
        { id: 3, role: "user", content: "你好吗" },
        { id: 4, role: "assistant", content: "你真行", act: "tease" },
      ],
      minScore: 0.05,
    });
    expect(found[0]?.content).toBe("你真行");
    expect(found[0]?.id).toBe(4);
  });

  it("ranks a turn outside the selected period behind one inside it", () => {
    const found = retrieveExemplars({
      userMessage: "你好吗",
      period: { from: "2022-01-01T00:00:00.000Z", to: "2022-06-01T00:00:00.000Z" },
      records: [
        {
          id: 1,
          role: "user",
          content: "你好吗",
          timestamp: new Date("2022-03-01T12:00:00.000Z"),
        },
        {
          id: 2,
          role: "assistant",
          content: "还行呀",
          timestamp: new Date("2022-03-01T12:00:05.000Z"),
        },
        {
          id: 3,
          role: "user",
          content: "你好吗",
          timestamp: new Date("2023-03-01T12:00:00.000Z"),
        },
        {
          id: 4,
          role: "assistant",
          content: "还行呢",
          timestamp: new Date("2023-03-01T12:00:05.000Z"),
        },
      ],
      minScore: 0.05,
    });
    expect(found.map((item) => item.id)).toEqual([2, 4]);
  });

  it("keeps only matching-act turns when restrictToSampledAct and at least two match", () => {
    const found = retrieveExemplars({
      userMessage: "你好吗",
      sampledAct: "tease",
      restrictToSampledAct: true,
      records: [
        { id: 1, role: "user", content: "你好吗" },
        { id: 2, role: "assistant", content: "还行", act: "acknowledge" },
        { id: 3, role: "user", content: "你好吗" },
        { id: 4, role: "assistant", content: "你真行", act: "tease" },
        { id: 5, role: "user", content: "你好吗" },
        { id: 6, role: "assistant", content: "行啊你", act: "tease" },
      ],
      minScore: 0.05,
    });
    expect(found.map((item) => item.content).sort()).toEqual(["你真行", "行啊你"].sort());
  });

  it("does not restrict when fewer than two matching-act turns pass the floor", () => {
    const found = retrieveExemplars({
      userMessage: "你好吗",
      sampledAct: "tease",
      restrictToSampledAct: true,
      records: [
        { id: 1, role: "user", content: "你好吗" },
        { id: 2, role: "assistant", content: "还行", act: "acknowledge" },
        { id: 3, role: "user", content: "你好吗" },
        { id: 4, role: "assistant", content: "你真行", act: "tease" },
      ],
      minScore: 0.05,
    });
    expect(found.map((item) => item.content)).toEqual(["你真行", "还行"]);
  });

  it("does not return a held-out line, a harm line, or a non-text row", () => {
    const found = retrieveExemplars({
      userMessage: "今晚吃什么",
      excludeIds: [4],
      excludeTexts: ["老地方那家面"],
      minScore: 0.05,
      personaData: {
        harmReport: {
          categories: [{ kind: "belittle", count: 1, examples: [10] }],
          decision: "pending",
        },
      },
      records: [
        { id: 1, role: "user", content: "今晚吃什么" },
        { id: 2, role: "assistant", content: "随便，你定" },
        { id: 3, role: "user", content: "今晚吃什么" },
        { id: 4, role: "assistant", content: "老地方那家面" },
        { id: 5, role: "user", content: "今晚吃什么" },
        { id: 10, role: "assistant", content: "你就是个废物" },
        { id: 7, role: "user", content: "今晚吃什么", kind: "text" },
        { id: 8, role: "assistant", content: "[sticker:狗狗探头]", kind: "sticker" },
      ],
    });
    expect(found.every((item) => item.id !== 4)).toBe(true);
    expect(found.every((item) => !item.content.includes("废物"))).toBe(true);
    expect(found.every((item) => !item.content.startsWith("[sticker:"))).toBe(true);
    expect(found.some((item) => item.content.includes("随便"))).toBe(true);
  });
});
