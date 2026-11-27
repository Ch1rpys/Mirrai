import { describe, expect, it } from "vitest";
import { mergeUserDecisions } from "./pipeline";
import type { PersonaData } from "../_core/persona-schema";
import type { MicroRule } from "@shared/micro-rules";

/**
 * What survives a re-run.
 *
 * A re-distillation rebuilds the persona from the records. It would
 * happily throw away everything the user worked out by hand — and those
 * things are exactly the things the model cannot work out on its own.
 * They are the user's decisions about a person the model cannot see.
 */
const fresh: PersonaData = {
  personality: "温柔",
  speakingStyle: "短句",
  catchphrases: ["嗯嗯"],
  nickname: "宝贝",
  memories: "",
  attachmentStyle: "",
  loveLanguage: "",
  conflictStyle: "",
  touchingMoments: "",
  summary: "",
  realismLevel: 70,
  relationshipPhase: "initial",
  microRules: [],
  imperfectionProfile: [],
};

const confirmed: MicroRule = {
  id: "r1",
  trigger: ["随便你"],
  meaning: "她真的生气了",
  rendering: "更短、更冷",
  confidence: 1,
  source: "manual",
  verified: true,
  evidence: [],
};

const candidate: MicroRule = {
  id: "auto-1",
  trigger: ["嗯嗯"],
  meaning: "心情好",
  rendering: "连发三条",
  confidence: 0.6,
  source: "auto",
  verified: false,
  evidence: [{ snippet: "嗯嗯" }],
};

describe("a re-run of the distillation", () => {
  it("keeps the rules the user confirmed", () => {
    const merged = mergeUserDecisions(
      fresh,
      { microRules: [confirmed] },
      [candidate],
      "zh",
    );
    expect(merged.microRules?.map((rule) => rule.id)).toContain("r1");
  });

  it("does not keep the candidates the user never confirmed", () => {
    const merged = mergeUserDecisions(
      fresh,
      { microRules: [candidate] },
      [],
      "zh",
    );
    expect(merged.microRules).toEqual([]);
  });

  it("does not add a mined rule the user has already confirmed", () => {
    // Two rules about the same word are two contradictory instructions
    // in one prompt, and the user's is the one they checked.
    const same: MicroRule = { ...candidate, id: "auto-2", trigger: ["随便你"] };
    const merged = mergeUserDecisions(
      fresh,
      { microRules: [confirmed] },
      [same],
      "zh",
    );
    expect(merged.microRules?.map((rule) => rule.id)).toEqual(["r1"]);
  });

  it("does not revive a rule the user rejected in the inference view (C10.6)", () => {
    const rejectedRule: MicroRule = { ...candidate, id: "auto-rejected" };
    const merged = mergeUserDecisions(
      fresh,
      { microRules: [], rejectedFeedbackKeys: ["rule:auto-rejected"] },
      [rejectedRule],
      "zh",
    );
    expect(merged.microRules).toEqual([]);
    expect(merged.rejectedFeedbackKeys).toEqual(["rule:auto-rejected"]);

    // Only the rejected one is filtered; a different fresh candidate
    // still comes through.
    const kept = mergeUserDecisions(
      fresh,
      { rejectedFeedbackKeys: ["rule:auto-rejected"] },
      [candidate],
      "zh",
    );
    expect(kept.microRules?.map((rule) => rule.id)).toEqual(["auto-1"]);
  });

  it("does not revive a subtraction the user rejected in the inference view (C10.6)", () => {
    const minedSuppressions = [
      {
        id: "auto-no-phrase",
        pattern: "好的吧",
        kind: "no_phrase" as const,
        confidence: 0.4,
        source: "auto" as const,
        verified: false,
        evidence: [{ snippet: "好的吧" }],
      },
      {
        id: "auto-no-advice",
        pattern: "你应该",
        kind: "no_advice" as const,
        confidence: 0.4,
        source: "auto" as const,
        verified: false,
        evidence: [{ snippet: "你应该" }],
      },
    ];
    const merged = mergeUserDecisions(
      fresh,
      { rejectedFeedbackKeys: ["suppression:no_phrase:好的吧"] },
      [],
      "zh",
      { suppressions: minedSuppressions },
    );
    expect(merged.suppressions?.map((row) => row.pattern)).toEqual(["你应该"]);
  });

  it("does not revive a life event the user rejected in the inference view (C10.6)", () => {
    const minedEvents = [
      {
        id: "open-loop-1",
        kind: "open_loop" as const,
        title: "说好下周见",
        detail: "说好下周见",
        whoSaid: "them",
        closed: false,
        source: "auto" as const,
        verified: false,
        evidence: [{ snippet: "说好下周见" }],
      },
      {
        id: "open-loop-2",
        kind: "open_loop" as const,
        title: "改天一起吃饭",
        detail: "改天一起吃饭",
        whoSaid: "me",
        closed: false,
        source: "auto" as const,
        verified: false,
        evidence: [{ snippet: "改天一起吃饭" }],
      },
    ];
    const merged = mergeUserDecisions(
      fresh,
      { rejectedFeedbackKeys: ["event:说好下周见"] },
      [],
      "zh",
      { lifeEvents: minedEvents },
    );
    expect(merged.lifeEvents?.map((event) => event.title)).toEqual(["改天一起吃饭"]);
  });

  it("adds the freshly mined candidates", () => {
    const merged = mergeUserDecisions(fresh, {}, [candidate], "zh");
    expect(merged.microRules?.map((rule) => rule.id)).toEqual(["auto-1"]);
  });

  it("keeps the per-state imperfection the user wrote", () => {
    const merged = mergeUserDecisions(
      fresh,
      { imperfectionProfile: [{ state: "distant", deviations: ["极短句"] }] },
      [],
      "zh",
    );
    expect(merged.imperfectionProfile).toHaveLength(1);
    expect(merged.imperfectionProfile?.[0].deviations).toEqual(["极短句"]);
  });

  it("does not invent an imperfection for a persona that never had one", () => {
    const merged = mergeUserDecisions(fresh, {}, [], "zh");
    expect(merged.imperfectionProfile).toEqual([]);
  });

  it("keeps everything else the fresh build produced", () => {
    const merged = mergeUserDecisions(
      { ...fresh, personality: "更温柔了" },
      { microRules: [confirmed] },
      [],
      "zh",
    );
    expect(merged.personality).toBe("更温柔了");
  });

  it("puts the rules the user confirmed before the ones just mined", () => {
    const merged = mergeUserDecisions(fresh, { microRules: [confirmed] }, [candidate], "zh");

    // The user's own decisions come first: they are the ones that took
    // effect, and the candidates are still waiting to be looked at.
    expect(merged.microRules?.map((rule) => rule.id)).toEqual(["r1", "auto-1"]);
  });

  it("leaves out a stored rule that cannot be obeyed", () => {
    const merged = mergeUserDecisions(
      fresh,
      {
        microRules: [
          {
            id: "r2",
            trigger: ["随便"],
            meaning: "她真的生气了",
            rendering: "",
            confidence: 1,
            source: "manual",
            verified: true,
            evidence: [],
          },
        ],
      },
      [],
      "zh",
    );

    // A rule without a rendering is not a rule — and it is not carried
    // over either.
    expect(merged.microRules).toEqual([]);
  });

  it("does not write the product's default into an empty state", () => {
    const merged = mergeUserDecisions(
      fresh,
      { imperfectionProfile: [{ state: "distant", deviations: [] }] },
      [],
    );
    expect(merged.imperfectionProfile ?? []).toEqual([]);
  });

  it("keeps a state the user actually wrote, in the language they wrote it", () => {
    const merged = mergeUserDecisions(
      fresh,
      { imperfectionProfile: [{ state: "distant", deviations: ["very short sentences"] }] },
      [],
      "en",
    );
    expect(merged.imperfectionProfile?.[0].deviations[0]).toBe("very short sentences");
  });

  it("keeps confirmed subtractions, life events and edited action counts", () => {
    const merged = mergeUserDecisions(
      fresh,
      {
        suppressions: [{
          id: "s1",
          pattern: "句末不问",
          kind: "no_question_ending",
          confidence: 1,
          source: "manual",
          verified: true,
          evidence: [{ snippet: "嗯" }],
        }],
        lifeEvents: [{
          id: "e1",
          kind: "open_loop",
          title: "说好下周见",
          detail: "",
          whoSaid: "them",
          closed: false,
          source: "manual",
          verified: true,
          evidence: [],
        }],
        actProfile: {
          samples: 80,
          unconditional: { tease: 12 },
          buckets: [],
          edited: true,
        },
        rejectedFeedbackKeys: ["word:9"],
      },
      [],
      "zh",
      {
        suppressions: [{
          id: "auto-s",
          pattern: "句末不问",
          kind: "no_question_ending",
          confidence: 0.4,
          source: "auto",
          verified: false,
          evidence: [{ snippet: "好" }],
        }],
        lifeEvents: [{
          id: "auto-e",
          kind: "open_loop",
          title: "说好下周见",
          detail: "auto",
          whoSaid: "",
          closed: false,
          source: "auto",
          verified: false,
          evidence: [{ snippet: "改天" }],
        }],
        actProfile: {
          samples: 80,
          unconditional: { answer: 40 },
          buckets: [],
        },
      },
    );
    expect(merged.suppressions?.map((row) => row.id)).toEqual(["s1"]);
    expect(merged.lifeEvents?.map((row) => row.id)).toEqual(["e1"]);
    expect(merged.actProfile?.unconditional.tease).toBe(12);
    expect(merged.rejectedFeedbackKeys).toEqual(["word:9"]);
  });

  it("keeps a harm decision the user already made", () => {
    const categories = [
      { kind: "belittle" as const, count: 5, examples: [1, 2, 3] },
    ];
    const merged = mergeUserDecisions(
      { ...fresh, harmReport: { categories, decision: "pending" } },
      { harmReport: { categories, decision: "keep", decidedAt: "2026-01-01T00:00:00.000Z" } },
      [],
    );
    expect(merged.harmReport?.decision).toBe("keep");
    expect(merged.harmReport?.categories[0]?.count).toBe(5);
    expect(merged.harmReport?.decidedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("keeps a confirmed private word and does not revive a rejected one", () => {
    const merged = mergeUserDecisions(
      fresh,
      {
        lexicon: [
          {
            id: "keep",
            term: "咕咕",
            gloss: "放鸽子",
            who: "them",
            count: 15,
            evidence: [{ snippet: "又咕咕了" }],
            source: "auto",
            verified: true,
          },
        ],
        rejectedFeedbackKeys: ["lexicon:专属黑话"],
      },
      [],
      "zh",
      {
        lexicon: [
          {
            id: "auto-gugu",
            term: "咕咕",
            gloss: "新的解释",
            who: "them",
            count: 16,
            evidence: [{ snippet: "又咕咕了" }],
            source: "auto",
            verified: false,
          },
          {
            id: "auto-slang",
            term: "专属黑话",
            gloss: "不该回来",
            who: "both",
            count: 8,
            evidence: [{ snippet: "专属黑话" }],
            source: "auto",
            verified: false,
          },
        ],
      },
    );
    expect(merged.lexicon?.map((row) => row.term)).toEqual(["咕咕"]);
    expect(merged.lexicon?.[0].gloss).toBe("放鸽子");
    expect(merged.lexicon?.[0].verified).toBe(true);
  });

  it("keeps a confirmed person and does not revive a rejected one", () => {
    const merged = mergeUserDecisions(
      fresh,
      {
        people: [
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
        rejectedFeedbackKeys: ["people:路过的人"],
      },
      [],
      "zh",
      {
        people: [
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
      },
    );
    expect(merged.people?.map((row) => row.name)).toEqual(["琪琪"]);
    expect(merged.people?.[0].relation).toBe("室友");
    expect(merged.people?.[0].verified).toBe(true);
  });

  it("keeps a confirmed stance and does not revive a rejected one", () => {
    const merged = mergeUserDecisions(
      fresh,
      {
        stances: [
          {
            id: "keep",
            topic: "香菜",
            polarity: "dislike",
            statement: "讨厌香菜",
            evidence: [{ snippet: "讨厌香菜" }, { snippet: "香菜不行" }],
            source: "auto",
            verified: true,
          },
        ],
        rejectedFeedbackKeys: ["stance:咖啡:like"],
      },
      [],
      "zh",
      {
        stances: [
          {
            id: "auto-cilantro",
            topic: "香菜",
            polarity: "dislike",
            statement: "香菜真难吃",
            evidence: [{ snippet: "讨厌香菜" }, { snippet: "香菜不行" }],
            source: "auto",
            verified: false,
          },
          {
            id: "auto-coffee",
            topic: "咖啡",
            polarity: "like",
            statement: "这家咖啡还行",
            evidence: [{ snippet: "这家咖啡还行" }, { snippet: "再来一杯" }],
            source: "auto",
            verified: false,
          },
        ],
      },
    );
    expect(merged.stances?.map((row) => row.topic)).toEqual(["香菜"]);
    expect(merged.stances?.[0].statement).toBe("讨厌香菜");
    expect(merged.stances?.[0].verified).toBe(true);
  });

  it("keeps the questions the user already answered", () => {
    const merged = mergeUserDecisions(
      fresh,
      { clarified: ["never_says", "address_angry"] },
      [],
    );
    expect(merged.clarified).toEqual(["never_says", "address_angry"]);
  });
});
