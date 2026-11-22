import { describe, expect, it } from "vitest";
import {
  DESCRIBED_FIELDS,
  DESCRIBED_MAX_STATEMENTS,
  normalizeDescribedStatements,
  parseDescribedStatements,
} from "./described";

const accounts = [
  { id: 3, tellerName: "阿树", body: "小满生气的时候\n一句话都不说。小满喜欢海。" },
  { id: 9, tellerName: "琪琪", body: "他讨厌香菜。" },
];

describe("described statements (C1.8)", () => {
  it("keeps a sentence only when its quote is in an account", () => {
    const parsed = parseDescribedStatements(
      [
        { field: "personality", text: "生气时先沉默。", quote: "生气的时候一句话都不说" },
        { field: "likes", text: "讨厌香菜。", quote: "讨厌香菜" },
        { field: "likes", text: "喜欢山。", quote: "喜欢爬山" },
      ],
      accounts,
    );
    expect(parsed.statements).toHaveLength(2);
    expect(parsed.dropped).toBe(1);
    expect(parsed.statements.every((row) => row.source === "described")).toBe(true);
    expect(parsed.statements[0]).toMatchObject({ teller: "阿树", accountId: 3 });
    expect(parsed.statements[1]).toMatchObject({ teller: "琪琪", accountId: 9 });
  });

  it("matches across a line break without inventing words", () => {
    const parsed = parseDescribedStatements(
      [{ text: "生气时先沉默。", quote: "生气的时候 一句话都不说" }],
      accounts,
    );
    expect(parsed.statements).toHaveLength(1);
    expect(parsed.statements[0]?.quote).toBe("生气的时候 一句话都不说");
  });

  it("does not keep the same sentence twice", () => {
    const parsed = parseDescribedStatements(
      [
        { field: "likes", text: "讨厌香菜。", quote: "讨厌香菜" },
        { field: "likes", text: "讨厌香菜。", quote: "他讨厌香菜" },
      ],
      accounts,
    );
    expect(parsed.statements).toHaveLength(1);
    expect(parsed.dropped).toBe(1);
  });

  it("drops a statement without text or quote", () => {
    const parsed = parseDescribedStatements(
      [
        { field: "likes", text: "", quote: "讨厌香菜" },
        { field: "likes", text: "讨厌香菜。" },
        null,
        "不是对象",
      ],
      accounts,
    );
    expect(parsed.statements).toEqual([]);
    expect(parsed.dropped).toBe(4);
  });

  it("caps how many one run may keep", () => {
    const many = Array.from({ length: DESCRIBED_MAX_STATEMENTS + 3 }, () => ({
      field: "likes",
      text: "讨厌香菜。",
      quote: "讨厌香菜",
    }));
    const parsed = parseDescribedStatements(many, accounts);
    expect(parsed.statements).toHaveLength(1); // all duplicates of one sentence
    expect(parsed.dropped).toBe(DESCRIBED_MAX_STATEMENTS + 2);
  });

  it("normalises what is stored on the persona, and drops a statement with no evidence", () => {
    const normalised = normalizeDescribedStatements([
      {
        text: "生气时先沉默。",
        source: "anything",
        quote: "生气的时候一句话都不说",
        field: "personality",
        teller: "阿树",
        accountId: 3,
      },
      { text: "没有原话。", source: "described" },
      { text: "未知字段。", quote: "小满喜欢海", field: "not-a-field" },
    ]);
    expect(normalised).toHaveLength(2);
    expect(normalised[0]).toMatchObject({
      text: "生气时先沉默。",
      source: "described",
      quote: "生气的时候一句话都不说",
      field: "personality",
      teller: "阿树",
      accountId: 3,
    });
    expect(normalised[1]?.field).toBe("personality");
  });

  it("knows the closed set of fields", () => {
    expect(DESCRIBED_FIELDS).toContain("personality");
    expect(DESCRIBED_FIELDS).toContain("boundaries");
    expect(DESCRIBED_FIELDS).not.toContain("not-a-field");
  });
});

describe("interview transcripts as evidence", () => {
  /**
   * The interview stores `问：…\n答：…` lines in the oral account. The
   * question is written by the model; only the answer is something the
   * person said.
   */
  const interviewAccounts = [
    {
      id: 21,
      tellerName: "阿树",
      body: "问：他喜欢吃什么？\n答：他喜欢吃面。\n问：他生气时什么样？\n答：他生气的时候一句话都不说。",
    },
  ];

  it("does not accept the interviewer's question as a quote", () => {
    const parsed = parseDescribedStatements(
      [{ field: "likes", text: "我不知道他喜欢吃什么。", quote: "他喜欢吃什么" }],
      interviewAccounts,
    );
    expect(parsed.statements).toHaveLength(0);
    expect(parsed.dropped).toBe(1);
  });

  it("still accepts a quote from an answer", () => {
    const parsed = parseDescribedStatements(
      [
        { field: "likes", text: "喜欢吃面。", quote: "他喜欢吃面" },
        { field: "personality", text: "生气时先沉默。", quote: "生气的时候一句话都不说" },
      ],
      interviewAccounts,
    );
    expect(parsed.statements).toHaveLength(2);
    expect(parsed.statements.every((row) => row.teller === "阿树")).toBe(true);
  });

  it("uses the whole body when it is not an interview transcript", () => {
    const parsed = parseDescribedStatements(
      [{ field: "likes", text: "讨厌香菜。", quote: "他讨厌香菜" }],
      accounts,
    );
    expect(parsed.statements).toHaveLength(1);
  });

  it("does not accept the question in an English transcript either", () => {
    // The interview is available in English; its markers are `Q:`/`A:`.
    const parsed = parseDescribedStatements(
      [{ field: "personality", text: "made up", quote: "What is she like when happy?" }],
      [
        {
          id: 22,
          tellerName: "Ash",
          body: "Q: What is she like when happy?\nA: She hums to herself.",
        },
      ],
    );
    expect(parsed.statements).toHaveLength(0);
    expect(parsed.dropped).toBe(1);

    const kept = parseDescribedStatements(
      [{ field: "personality", text: "hums when happy", quote: "She hums to herself." }],
      [
        {
          id: 23,
          tellerName: "Ash",
          body: "Q: What is she like when happy?\nA: She hums to herself.",
        },
      ],
    );
    expect(kept.statements).toHaveLength(1);
  });

  it("keeps a quote that runs over several lines of one answer", () => {
    // Shift+Enter is allowed in the composer: the continuation lines are
    // still the person's own words and were being dropped entirely.
    const parsed = parseDescribedStatements(
      [{ field: "personality", text: "quietly hums", quote: "声音很轻，只在我们两个人的时候" }],
      [
        {
          id: 24,
          tellerName: "阿树",
          body: "问：高兴的时候是什么样？\n答：她会哼歌\n声音很轻，只在我们两个人的时候\n问：生气的时候呢？\n答：她会沉默。",
        },
      ],
    );
    expect(parsed.statements).toHaveLength(1);
    expect(parsed.statements[0]?.quote).toBe("声音很轻，只在我们两个人的时候");
  });
});
