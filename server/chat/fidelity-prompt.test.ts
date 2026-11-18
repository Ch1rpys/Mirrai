import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../_core/persona-utils";

/**
 * The rules and the imperfection, in the prompt.
 *
 * Two things have to be true, and they are easy to get wrong:
 *
 *   the rules must sit with the persona's own instructions rather than
 *   at the end of the prompt, because a rule that arrives as a closing
 *   note is read as a closing note; and
 *
 *   the imperfection must apply to the state the persona is actually in,
 *   because a persona that is imperfect in six states at once is a
 *   persona with one personality wearing six hats.
 */
const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "distant",
  timezone: "Asia/Shanghai",
  relationshipDesc: "前女友",
  togetherFrom: "2021-06-15",
  togetherTo: null,
  personaData: {
    personality: "温柔",
    speakingStyle: "慢慢说",
    microRules: [
      {
        id: "r1",
        trigger: ["随便你"],
        meaning: "她真的生气了",
        rendering: "更短、更冷，不解释",
        confidence: 0.8,
        source: "manual",
        verified: true,
        evidence: [{ snippet: "随便你" }],
      },
    ],
    imperfectionProfile: [
      { state: "distant", deviations: ["极短句", "不解释"] },
      { state: "happy", deviations: ["会连着发三条"] },
    ],
  },
} as any;

describe("the discriminative rules in the prompt", () => {
  it("says them out loud", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    expect(prompt).toContain("随便你");
    expect(prompt).toContain("她真的生气了");
    expect(prompt).toContain("更短、更冷，不解释");
  });

  it("puts them next to the speaking style, not at the end", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    const speaking = prompt.indexOf("慢慢说");
    const rules = prompt.indexOf("随便你");
    expect(speaking).toBeGreaterThanOrEqual(0);
    expect(rules).toBeGreaterThan(speaking);
    // The rules are instructions, so they belong before the closing
    // principles rather than after them — and the position is a real
    // position, not a number that is always true.
    const principles = prompt.indexOf("【对话原则】");
    const state = prompt.indexOf("【当前状态】");
    expect(principles).toBeGreaterThan(-1);
    expect(rules).toBeLessThan(principles);
    expect(rules).toBeGreaterThan(speaking);
    // And before the dynamic state section, so the two are read in the
    // order a person would act in them.
    if (state > -1) expect(rules).toBeLessThan(state);
  });

  it("says nothing about a rule the user has not confirmed", () => {
    const unverified = {
      ...persona,
      personaData: {
        ...persona.personaData,
        microRules: [{ ...persona.personaData.microRules[0], verified: false }],
      },
    };
    const prompt = buildSystemPrompt(unverified, { locale: "zh" });
    expect(prompt).not.toContain("随便你");
  });

  it("can be switched off without touching the persona", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh", microRules: null });
    expect(prompt).not.toContain("随便你");
  });

  it("writes the framing in English and keeps the user's own words", () => {
    const prompt = buildSystemPrompt(persona, { locale: "en" });
    expect(prompt).toContain("Discriminative rules");
    expect(prompt).toContain("她真的生气了");
  });
});

describe("the imperfection in the prompt", () => {
  it("applies the state the persona is in", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    expect(prompt).toContain("极短句");
    expect(prompt).toContain("不解释");
  });

  it("does not apply the other states", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    expect(prompt).not.toContain("会连着发三条");
  });

  it("follows the state it is given", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh", emotionalState: "happy" });
    expect(prompt).toContain("会连着发三条");
    expect(prompt).not.toContain("极短句");
  });

  it("says nothing when the persona is meant to be perfect", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh", realismLevel: 0 });
    expect(prompt).not.toContain("极短句");
  });

  it("can be switched off without touching the persona", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh", imperfectionProfile: null });
    expect(prompt).not.toContain("极短句");
  });

  it("does not fill a state the user never wrote with the product's sentence", () => {
    // The editor still shows six boxes. The prompt only uses what was
    // actually stored — a distant persona must not pick up the generic
    // melancholy line every other persona ships with.
    const prompt = buildSystemPrompt(
      {
        ...persona,
        emotionalState: "melancholy",
        personaData: {
          ...persona.personaData,
          imperfectionProfile: [
            { state: "distant", deviations: ["极短句"] },
          ],
        },
      },
      { locale: "zh" },
    );
    expect(prompt).not.toContain("不解释自己");
    const distant = buildSystemPrompt(
      {
        ...persona,
        emotionalState: "distant",
        personaData: {
          ...persona.personaData,
          imperfectionProfile: [
            { state: "distant", deviations: ["极短句"] },
          ],
        },
      },
      { locale: "zh" },
    );
    expect(distant).toContain("极短句");
    expect(distant).not.toContain("不解释自己");
  });

  it("does not put a counted draft into the prompt until the user takes it", () => {
    const prompt = buildSystemPrompt(
      {
        ...persona,
        emotionalState: "distant",
        styleProfile: {
          version: 1,
          measuredAt: "2026-01-01T00:00:00.000Z",
          recordsVersion: "1:1",
          imperfectionDrafts: {
            distant: [{ text: "话很短，通常不超过 4 个字", evidence: [1, 2, 3] }],
          },
        },
        personaData: { ...persona.personaData, imperfectionProfile: [] },
      },
      { locale: "zh" },
    );
    expect(prompt).not.toContain("话很短");
    expect(prompt).not.toContain("通常不超过");
  });

  it("gives a persona that never opted in nothing at all", () => {
    // A persona built before this field existed must not quietly gain a
    // personality nobody chose for it.
    const prompt = buildSystemPrompt(
      {
        ...persona,
        emotionalState: "melancholy",
        personaData: { ...persona.personaData, imperfectionProfile: [] },
      },
      { locale: "zh" },
    );
    expect(prompt).not.toContain("不解释自己");
  });

  it("follows the mood the prompt states, not the one it happens to be stored in", () => {
    // A scene can set the mood the persona speaks in. If the prompt
    // says "you are distant" and then applies the deviations of "happy",
    // it is telling the model two different things at once.
    const prompt = buildSystemPrompt(persona, {
      locale: "zh",
      emotionalState: "happy",
      emotionalDesc: "开心，充满活力",
    });
    expect(prompt).toContain("会连着发三条");
    expect(prompt).not.toContain("极短句");
  });

  it("puts a confirmed subtraction next to the rules and not an unconfirmed one", () => {
    const withBan = {
      ...persona,
      personaData: {
        ...persona.personaData,
        suppressions: [
          {
            id: "s1",
            pattern: "句末不问",
            kind: "no_question_ending",
            confidence: 0.9,
            source: "manual",
            verified: true,
            evidence: [{ snippet: "嗯" }],
          },
          {
            id: "s2",
            pattern: "我理解你",
            kind: "no_phrase",
            confidence: 0.6,
            source: "auto",
            verified: false,
            evidence: [{ snippet: "好" }],
          },
        ],
      },
    };
    const prompt = buildSystemPrompt(withBan, { locale: "zh" });
    expect(prompt).toContain("不要以问句收尾");
    expect(prompt).not.toContain("我理解你");
    const speaking = prompt.indexOf("慢慢说");
    const rules = prompt.indexOf("随便你");
    const subtraction = prompt.indexOf("不要以问句收尾");
    expect(subtraction).toBeGreaterThan(speaking);
    expect(subtraction).toBeGreaterThan(rules);
  });

  it("does not mention a multi-point habit until the user confirms it", () => {
    const candidate = {
      id: "s-multi",
      pattern: "通常接最后一件",
      kind: "multi_point",
      confidence: 0.7,
      source: "auto",
      verified: false,
      evidence: [{ snippet: "到家了。今天好累" }],
    };
    const before = buildSystemPrompt(
      {
        ...persona,
        personaData: { ...persona.personaData, suppressions: [candidate] },
      },
      { locale: "zh" },
    );
    expect(before).not.toContain("只接其中一件");
    expect(before).not.toContain("通常接最后一件");
    const after = buildSystemPrompt(
      {
        ...persona,
        personaData: {
          ...persona.personaData,
          suppressions: [{ ...candidate, verified: true }],
        },
      },
      { locale: "zh" },
    );
    expect(after).toContain("只接其中一件");
    expect(after).toContain("通常接最后一件");
    const fenced = /<persona_data>[\s\S]*?<\/persona_data>/g;
    const unfenced = after.replace(fenced, "");
    expect(unfenced).not.toContain("通常接最后一件");
    expect(after.indexOf("【减法】")).toBeGreaterThan(-1);
  });

  it("does not mention a knowledge boundary until the user confirms it", () => {
    const candidate = {
      id: "s-knowledge",
      pattern: "股票基金理财",
      kind: "knowledge_boundary",
      confidence: 0.7,
      source: "auto",
      verified: false,
      evidence: [{ snippet: "听不懂 说人话" }],
    };
    const before = buildSystemPrompt(
      {
        ...persona,
        personaData: { ...persona.personaData, suppressions: [candidate] },
      },
      { locale: "zh" },
    );
    expect(before).not.toContain("你不懂这类话题");
    expect(before).not.toContain("股票基金理财");
    const after = buildSystemPrompt(
      {
        ...persona,
        personaData: {
          ...persona.personaData,
          suppressions: [{ ...candidate, verified: true }],
        },
      },
      { locale: "zh" },
    );
    expect(after).toContain("你不懂这类话题");
    expect(after).toContain("股票基金理财");
    const fenced = /<persona_data>[\s\S]*?<\/persona_data>/g;
    const unfenced = after.replace(fenced, "");
    expect(unfenced).not.toContain("股票基金理财");
    expect(after.indexOf("【减法】")).toBeGreaterThan(-1);
  });

  it("names one action in the instruction zone", () => {
    const prompt = buildSystemPrompt(persona, { locale: "zh", sampledAct: "tease" });
    expect(prompt).toContain("开玩笑、损一下");
    expect(prompt).not.toContain("安慰");
    expect(prompt).toContain("这一轮只做这件事");
  });

  it("says nothing for a persona that was distilled before it existed", () => {
    const old = { ...persona, personaData: { personality: "温柔", speakingStyle: "慢慢说" } };
    const prompt = buildSystemPrompt(old, { locale: "zh" });
    expect(prompt).toContain("慢慢说");
    expect(prompt).not.toContain("不完美的特征");
  });
});

describe("private words in the prompt", () => {
  it("says nothing about a word the user has not confirmed", () => {
    const prompt = buildSystemPrompt(
      {
        ...persona,
        personaData: {
          ...persona.personaData,
          lexicon: [
            {
              id: "l1",
              term: "咕咕",
              gloss: "放鸽子",
              who: "them",
              count: 15,
              evidence: [{ snippet: "又咕咕了" }],
              source: "auto",
              verified: false,
            },
          ],
        },
      },
      { locale: "zh" },
    );
    expect(prompt).not.toContain("咕咕");
  });

  it("puts a confirmed word in the speaking-style fence", () => {
    const prompt = buildSystemPrompt(
      {
        ...persona,
        personaData: {
          ...persona.personaData,
          lexicon: [
            {
              id: "l1",
              term: "咕咕",
              gloss: "放鸽子",
              who: "them",
              count: 15,
              evidence: [{ snippet: "又咕咕了" }],
              source: "auto",
              verified: true,
            },
          ],
        },
      },
      { locale: "zh" },
    );
    expect(prompt).toContain("你们之间的说法：咕咕——放鸽子");
    const withoutFence = prompt.replace(/<persona_data>[\s\S]*?<\/persona_data>/g, "");
    expect(withoutFence).not.toContain("咕咕");
  });

  it("can be switched off without touching the persona", () => {
    const withLexicon = {
      ...persona,
      personaData: {
        ...persona.personaData,
        lexicon: [
          {
            id: "l1",
            term: "咕咕",
            gloss: "放鸽子",
            who: "them",
            count: 15,
            evidence: [{ snippet: "又咕咕了" }],
            source: "auto",
            verified: true,
          },
        ],
      },
    };
    const prompt = buildSystemPrompt(withLexicon, { locale: "zh", lexicon: null });
    expect(prompt).not.toContain("咕咕");
  });
});
