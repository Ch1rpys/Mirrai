import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { generateChatExportHTML, generateManualHTML } from "./_core/export-html";

/**
 * The keepsake.
 *
 * The HTML export was hardcoded Chinese whatever the interface was, so
 * an English-speaking user downloaded a keepsake they could not read.
 * The headings were swapped for a lookup table while the strings they
 * replaced stayed where they were — the table existed and nothing used
 * it. A test is the only thing that catches that.
 */
const params = {
  persona: {
    name: "小A",
    relationshipDesc: "ex-girlfriend",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    farewellLetter: "Thank you for everything.",
    graduatedAt: new Date("2024-02-01T00:00:00Z"),
  },
  messages: [
    {
      role: "user",
      content: "在吗",
      emotionalState: null,
      messageType: "text",
      createdAt: new Date("2024-01-01T10:00:00Z"),
    },
    {
      role: "assistant",
      content: "在的。",
      emotionalState: "warm",
      messageType: "text",
      createdAt: new Date("2024-01-01T10:00:05Z"),
    },
  ],
  memories: [
    {
      title: "第一次见面",
      description: "在图书馆门口",
      category: "milestone",
      date: "2019-05-20",
      createdAt: new Date("2019-05-20T00:00:00Z"),
    },
  ],
  emotionSnapshots: [
    { emotionalState: "warm", messageCount: 3, date: "2024-01-01", createdAt: new Date("2024-01-01T00:00:00Z") },
  ],
  diaryEntries: [
    { date: "2024-01-01", summary: "今天聊了聊。", reflection: "有点想她。" },
  ],
  letters: [
    {
      body: "有件事我一直没说。",
      kind: "letter",
      status: "answered",
      replyText: "我知道。",
      repliedAt: new Date("2024-02-02T00:00:00Z"),
      createdAt: new Date("2024-02-01T00:00:00Z"),
    },
  ],
  intimacy: { score: 720, level: "intimate" },
};

describe("the HTML export", () => {
  it("follows the language it is asked for", () => {
    const zh = generateChatExportHTML(params, "zh");
    const en = generateChatExportHTML(params, "en");

    expect(zh).toContain("<h2>记忆里程碑</h2>");
    expect(en).toContain("<h2>Milestones</h2>");
    expect(en).toContain("<h2>Diaries</h2>");
    expect(en).toContain("<h2>Letters</h2>");
    expect(en).toContain("<h2>The farewell letter</h2>");
  });

  it("does not leave Chinese in the English export", () => {
    const en = generateChatExportHTML(params, "en");
    const han = /[一-鿿]/g;
    const found = en.match(han);
    // The content itself is Chinese — that is the user's own writing. What
    // must not be there is the app's own wording.
    const withoutContent = en
      // The persona's name is the user's own content, not the app's.
      .replace(/小A/g, "")
      .replace(/<p class="mem-title">[^<]*<\/p>/g, "")
      .replace(/<p class="mem-desc">[^<]*<\/p>/g, "")
      .replace(/<p>[^<]*<\/p>/g, "")
      .replace(/<p class="reflection">[^<]*<\/p>/g, "")
      .replace(/<div class="bubble [^"]*">[^<]*<\/div>/g, "");
    expect(withoutContent.match(han)).toBeNull();
  });

  it("says which language it is in", () => {
    expect(generateChatExportHTML(params, "en")).toContain('<html lang="en">');
    expect(generateChatExportHTML(params, "zh")).toContain('<html lang="zh-CN">');
  });

  it("carries the letters, which are the artefact worth keeping", () => {
    const html = generateChatExportHTML(params, "zh");
    expect(html).toContain("有件事我一直没说。");
    expect(html).toContain("我知道。");
  });

  it("names the intimacy level in words, not in a key", () => {
    expect(generateChatExportHTML(params, "zh")).toContain("亲密");
    expect(generateChatExportHTML(params, "en")).toContain("Intimate");
  });
});

describe("the printable manual", () => {
  const fingerprint = {
    samples: 100,
    length: { median: 8, p90: 15, p95: 24, histogram: [] },
    turnChars: { median: 12, p95: 30 },
    endings: {
      period: 0.01,
      ellipsis: 0,
      question: 0.1,
      exclaim: 0,
      tilde: 0,
      emoji: 0,
      particle: 0.6,
      other: 0.29,
    },
    particles: { none: 0.4, 呀: 0.5, 呢: 0 },
    punctuation: {
      commaPerChar: 0,
      spaceAsComma: 0,
      ellipsisForms: { unicode: 0, dots: 0, cjkDots: 0 },
      exclaimRuns: [],
      questionRuns: [],
      halfWidthRate: 0,
      markCount: 0,
    },
    laugh: { rate: 0.2, forms: {}, haRuns: [] },
    reduplication: {},
    emoji: { rate: 0, perLine: 0, top: [] },
    kaomoji: { rate: 0 },
    latin: { rate: 0, abbreviations: {} },
    typoFix: { starRate: 0 },
    script: { traditionalRate: 0 },
    address: {},
    perState: { distant: { endings: { period: 0.9 } } },
  };

  const input = {
    persona: {
      name: "小满",
      relationshipDesc: "前任",
      togetherFrom: "2021-05",
      togetherTo: null,
    },
    personaData: {
      microRules: [
        {
          id: "r1",
          trigger: ["哦"],
          meaning: "冷淡",
          rendering: "回得更短",
          confidence: 0.9,
          source: "auto",
          verified: true,
          evidence: [{ snippet: "<script>alert(1)</script>", at: "2022-03-01T00:00:00.000Z" }],
        },
        {
          id: "r2",
          trigger: ["UNCONFIRMED-TRIGGER"],
          meaning: "UNCONFIRMED-MEANING",
          rendering: "UNCONFIRMED-RENDERING",
          confidence: 0.5,
          source: "auto",
          verified: false,
          evidence: [{ snippet: "UNCONFIRMED-EVIDENCE" }],
        },
      ],
      people: [
        {
          id: "p1",
          name: "琪琪",
          aliases: [],
          relation: "室友",
          side: "them",
          mentions: 12,
          evidence: [{ snippet: "琪琪今天不在", at: "2022-03-02T00:00:00.000Z" }],
          source: "auto",
          verified: true,
        },
        {
          id: "p2",
          name: "UNCONFIRMED-PERSON",
          aliases: [],
          relation: "路过的人",
          side: "them",
          mentions: 2,
          evidence: [{ snippet: "UNCONFIRMED-PERSON-EVIDENCE" }],
          source: "auto",
          verified: false,
        },
      ],
      stances: [
        {
          id: "s1",
          topic: "香菜",
          polarity: "dislike",
          statement: "讨厌香菜",
          evidence: [{ snippet: "香菜不行", at: "2022-03-03T00:00:00.000Z" }],
          source: "auto",
          verified: true,
        },
        {
          id: "s2",
          topic: "UNCONFIRMED-TOPIC",
          polarity: "like",
          statement: "UNCONFIRMED-STANCE",
          evidence: [{ snippet: "UNCONFIRMED-STANCE-EVIDENCE" }],
          source: "auto",
          verified: false,
        },
      ],
      lexicon: [
        {
          id: "l1",
          term: "咕咕",
          gloss: "放鸽子",
          who: "both",
          count: 15,
          evidence: [{ snippet: "你又咕咕了", at: "2022-03-04T00:00:00.000Z" }],
          source: "auto",
          verified: true,
        },
        {
          id: "l2",
          term: "UNCONFIRMED-TERM",
          gloss: "UNCONFIRMED-GLOSS",
          who: "both",
          count: 5,
          evidence: [{ snippet: "UNCONFIRMED-LEXICON-EVIDENCE" }],
          source: "auto",
          verified: false,
        },
      ],
    },
    styleProfile: { fingerprint, triggers: null, conflict: null, routine: null },
  };

  it("escapes the record's own words and leaves the unconfirmed candidates out", () => {
    const html = generateManualHTML(input as never, "zh");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("UNCONFIRMED");
    expect(html).toContain("琪琪");
    expect(html).toContain("讨厌香菜");
    expect(html).toContain("咕咕");
  });

  it("leaves out the making-up section when no conflict was measured", () => {
    const html = generateManualHTML(input as never, "zh");
    expect(html).not.toContain("怎么和好");
    expect(html).toContain("这份文档是从你导入的记录里整理的");
  });

  it("prints the measured way of speaking and the footer", () => {
    const html = generateManualHTML(input as never, "zh");
    expect(html).toContain("几乎不用句号");
    expect(html).toContain("从不用「呢」");
    expect(html).toContain("小满 的说明书");
  });

  it("has no model import anywhere in the manual's file", () => {
    const source = readFileSync(path.join(__dirname, "_core", "export-html.ts"), "utf-8");
    expect(source).not.toMatch(/from\s+["'][^"']*server\/llm/);
    expect(source).not.toMatch(/from\s+["']\.\.?\/llm/);
  });
});
