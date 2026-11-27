import { describe, expect, it } from "vitest";
import {
  STYLE_PROFILE_KEYS,
  STYLE_PROFILE_KEYS_MATCH_INTERFACE,
  type StyleProfile,
} from "@shared/style-profile";
import { COPY, copy } from "@shared/copy";
import {
  STYLE_PROFILE_KEY_COPY,
  buildInferenceSections,
  personaHasMeasurements,
  rejectedFeedbackKeyForCandidate,
  type BuildInferenceInput,
} from "./list";

/** A style profile with every measured key present. */
function fullProfile(): StyleProfile {
  return {
    version: 1,
    measuredAt: "2026-11-01T00:00:00.000Z",
    recordsVersion: "3200:9000",
    fingerprint: { samples: 300, endings: { other: 1, period: 0, ellipsis: 0, question: 0, tilde: 0, particle: 0, emoji: 0 } } as never,
    userSide: { samples: 40, sampleLines: ["在吗"] } as never,
    rituals: [{ trigger: "晚安", replies: [{ text: "晚安", count: 10 }], total: 10 }] as never,
    samplePool: { warm: ["在的呀"] } as never,
    imperfectionDrafts: { drafts: [] } as never,
    discriminator: { rules: [] } as never,
    replyDelay: { samples: 50, resolution: "second", buckets: { all: { n: 50, mu: 3.5, sigma: 0.8 } } } as never,
    routine: { days: 90, sleep: { startMin: 0, endMin: 450 } } as never,
    typing: { msPerChar: 200, burstGapMs: { p10: 100, p25: 200, p50: 400, p75: 600, p90: 900 }, pairs: 40 } as never,
    quirks: { typoRate: 0.1, recallRate: 0.05, patRate: 0.02 } as never,
    doubleText: { samples: 40, opportunities: 30, rate: 0.3, waitSec: { p25: 120, median: 300, p75: 600 }, lines: [{ text: "人呢", n: 20 }] } as never,
    sessions: { scenes: 30, lengthMin: { median: 15, p90: 40 }, closeByThemRate: 0.8, closers: [] } as never,
    inSession: { samples: 20, selfStartRate: 0.3 } as never,
    multiPoint: { samples: 20, coverageMedian: 1.2, preferLast: 0.8 } as never,
    emotionDynamics: { samples: 40, modal: "warm", transitions: { warm: { happy: 3 } } } as never,
    conflict: { episodes: 6, durationMin: { all: [180, 240, 300, 300, 360, 480], median: 300 }, repairBy: { them: 4, me: 2 }, repairAcceptRate: 0.6, repairLines: ["好啦 不气了"], coldLines: ["随便。"] } as never,
    triggers: [{ userAct: "ask", to: "distant", n: 6, examples: [{ text: "怎么又加班" }] }] as never,
    actClusters: { tease: [{ lines: ["你猜"], size: 5 }] } as never,
    addressHistory: [{ address: "树树", from: "2022-03", to: "2023-01" }] as never,
    stickers: { samples: 40, rate: 0.2, soloRate: 0.1, byState: {}, runs: { one: 1, two: 1, threePlus: 1 } } as never,
    voice: { samples: 40, rate: 0.1, durationSec: { median: 12, p90: 30 } } as never,
    photos: { samples: 40, rate: 0.1, byState: {} } as never,
    calls: { samples: 20, byDirection: { in: 14, out: 6, missed: 2 }, durationSec: { median: 600, p90: 3600, total: 24000 }, perWeekMedian: 2, longest: { recordId: 7, at: "2024-01-07T21:00:00.000Z", durationSec: 3600 }, first: { recordId: 1, at: "2022-03-06T21:00:00.000Z" }, last: { recordId: 7, at: "2024-01-07T21:00:00.000Z" }, answerSlots: [] } as never,
    publicFingerprint: { samples: 20 } as never,
    writtenFingerprint: { samples: 20 } as never,
    group: { samples: 30, afterMeRate: 0.6, afterOthersRate: 0.2, lengthMedian: 5, gapMedianMessages: 3 } as never,
    mirror: { starts: { me: 10, them: 5 } } as never,
    rerankWeights: { length: -0.4 },
  };
}

function input(overrides: Partial<BuildInferenceInput> = {}): BuildInferenceInput {
  return {
    user: {
      addressStyle: "叫我阿树",
      boundaries: "不谈工作",
      trajectoryAssessment: "auto",
      trajectoryLatest: "stable (2026-11-01)",
      mood: { date: "2026-11-20", mood: "calm", note: "还行" },
      safetyEvents: [{ type: "distress", severity: "info", createdAt: "2026-11-20T00:00:00Z" }],
      checkins: [{ answer: "还好", personaName: "小满", createdAt: "2026-11-20T00:00:00Z" }],
    },
    personas: [{
      persona: {
        id: 5,
        name: "小满",
        styleProfile: fullProfile(),
        settings: { disabledProfiles: ["conflict"] },
        personaData: {
          personality: "温柔",
          speakingStyle: "短句",
          people: [
            { id: "p-qiqi", name: "琪琪", relation: "室友", mentions: 12, verified: true, source: "auto" } as never,
            { id: "p-mom", name: "我妈", relation: "家人", mentions: 9, verified: false, source: "auto" } as never,
          ],
          stances: [
            { id: "s-sea", topic: "海", polarity: "like", statement: "喜欢海", verified: true, source: "auto" } as never,
            { id: "s-cilantro", topic: "香菜", polarity: "dislike", statement: "讨厌香菜", verified: false, source: "auto" } as never,
          ],
          lexicon: [
            { id: "l-gugu", term: "咕咕", gloss: "放鸽子", verified: true, source: "auto" } as never,
          ],
          microRules: [
            { id: "r-one", trigger: ["在吗"], meaning: "想聊天", rendering: "回在", verified: false, source: "auto" } as never,
          ],
          suppressions: [
            { id: "x-stock", pattern: "股票", kind: "knowledge_boundary", verified: false, source: "auto" } as never,
          ],
          lifeEvents: [
            { id: "e-trip", kind: "routine", title: "周末上课", detail: "", whoSaid: "them", closed: false, verified: false, source: "auto", schedule: { weekdays: [6], startHour: 16, endHour: 18 } } as never,
          ],
        },
      },
      memories: [
        { id: 11, title: "生日是 5 月 21 日", subject: "them", source: "records", category: "anchor" },
        { id: 12, title: "阿树在拾光咖啡第一次见面", subject: "me", source: "records", category: "memory" },
        { id: 13, title: "说要带你去吃面", subject: "said", source: "chat", category: "memory" },
      ],
      emotionTrend: [{ emotionalState: "warm" }],
      disabledProfiles: ["conflict"],
    }],
    ...overrides,
  };
}

describe("the inference view", () => {
  it("keeps the style profile key list equal to the interface", () => {
    // The compile-time assertion in `shared/style-profile.ts` is the real
    // check; this makes the intent visible at runtime too, and freezes
    // the names so a rename shows up here as well.
    expect(STYLE_PROFILE_KEYS_MATCH_INTERFACE).toBe(true);
    expect([...STYLE_PROFILE_KEYS].sort()).toEqual([
      "actClusters", "addressHistory", "calls", "conflict", "discriminator",
      "doubleText", "emotionDynamics", "fingerprint", "group", "imperfectionDrafts",
      "inSession", "mirror", "multiPoint", "photos", "publicFingerprint",
      "replyDelay", "rerankWeights", "rituals", "routine", "samplePool",
      "sessions", "stickers", "triggers", "typing", "userSide", "voice",
      "writtenFingerprint", "quirks",
    ].sort());
  });

  it("has a description in both languages for every style profile key", () => {
    for (const key of STYLE_PROFILE_KEYS) {
      const copyKey = STYLE_PROFILE_KEY_COPY[key];
      expect(copyKey, `${key} has no copy key`).toBeTruthy();
      expect((COPY as Record<string, unknown>)[copyKey], `${copyKey} is not in the copy table`).toBeTruthy();
      expect(copy("zh", copyKey)).not.toBe(copyKey);
      expect(copy("en", copyKey)).not.toBe(copyKey);
      expect(copy("en", copyKey)).not.toBe(copy("zh", copyKey));
    }
  });

  it("builds the durable rejection key for every candidate kind (C10.6)", () => {
    // These are the same key shapes `mergeUserDecisions` filters the next
    // distillation's candidates against.
    expect(rejectedFeedbackKeyForCandidate("microRules", { id: "auto-x" })).toBe("rule:auto-x");
    expect(rejectedFeedbackKeyForCandidate("suppressions", { kind: "no_phrase", pattern: "好的吧" }))
      .toBe("suppression:no_phrase:好的吧");
    expect(rejectedFeedbackKeyForCandidate("lifeEvents", { title: "说好下周见" }))
      .toBe("event:说好下周见");
    expect(rejectedFeedbackKeyForCandidate("people", { name: "琪琪" })).toBe("people:琪琪");
    expect(rejectedFeedbackKeyForCandidate("stances", { topic: "咖啡", polarity: "like" }))
      .toBe("stance:咖啡:like");
    expect(rejectedFeedbackKeyForCandidate("lexicon", { term: "咕咕" })).toBe("lexicon:咕咕");
    // A row without the pieces has no stable key; it is still removed.
    expect(rejectedFeedbackKeyForCandidate("stances", { topic: "咖啡", polarity: "bogus" })).toBeNull();
    expect(rejectedFeedbackKeyForCandidate("people", {})).toBeNull();
    expect(rejectedFeedbackKeyForCandidate("microRules", { id: "  " })).toBeNull();
  });

  it("covers every style profile key that exists", () => {
    const sections = buildInferenceSections(input());
    const personaSection = sections.find((section) => section.id === "persona-5")!;
    const labels = new Set(personaSection.items.map((item) => item.labelKey));
    for (const key of STYLE_PROFILE_KEYS) {
      expect(labels, `${key} has no item`).toContain(STYLE_PROFILE_KEY_COPY[key]);
    }
    // The key the owner turned off is still listed, marked off, with a
    // way back.
    const conflict = personaSection.items.find(
      (item) => item.labelKey === STYLE_PROFILE_KEY_COPY.conflict,
    )!;
    expect(conflict.disabled).toBe(true);
    expect(conflict.action).toEqual({ kind: "toggleStyleKey", styleKey: "conflict", disabled: true });
    const fingerprint = personaSection.items.find(
      (item) => item.labelKey === STYLE_PROFILE_KEY_COPY.fingerprint,
    )!;
    expect(fingerprint.source).toBe("measured");
    expect(fingerprint.action).toEqual({ kind: "toggleStyleKey", styleKey: "fingerprint", disabled: false });
  });

  it("lists every kind of candidate, with its source and a way to reject it", () => {
    const sections = buildInferenceSections(input());
    const personaSection = sections.find((section) => section.id === "persona-5")!;
    const byLabel = (key: string) => personaSection.items.filter((item) => item.labelKey === key);

    const people = byLabel("inference.field.people");
    expect(people).toHaveLength(2);
    expect(people.find((item) => item.evidence?.includes("琪琪") || item.detail?.includes("琪琪"))?.source).toBe("confirmed");
    expect(people.find((item) => item.detail?.includes("我妈"))?.source).toBe("mined");
    expect(people.find((item) => item.detail?.includes("我妈"))?.action).toEqual({
      kind: "rejectCandidate",
      candidateKind: "people",
      key: "p-mom",
    });

    expect(byLabel("inference.field.stances").map((item) => item.source).sort()).toEqual([
      "confirmed",
      "mined",
    ]);
    expect(byLabel("inference.field.lexicon")).toHaveLength(1);
    expect(byLabel("inference.field.microRules")).toHaveLength(1);
    expect(byLabel("inference.field.suppressions")).toHaveLength(1);
    expect(byLabel("inference.field.lifeEvents")).toHaveLength(1);
    // The unverified ones can be rejected; the confirmed ones point at
    // the persona editor instead.
    const mined = personaSection.items.filter((item) => item.source === "mined" && item.action?.kind === "rejectCandidate");
    expect(mined).toHaveLength(5);
  });

  it("lists the persona document fields as the user's own words", () => {
    const sections = buildInferenceSections(input());
    const personaSection = sections.find((section) => section.id === "persona-5")!;
    const personality = personaSection.items.find(
      (item) => item.labelKey === "inference.field.personality",
    )!;
    expect(personality.source).toBe("written");
    expect(personality.detail).toBe("温柔");
    expect(personality.action).toEqual({ kind: "editPersona", personaId: 5 });
  });

  it("puts memories on the side they belong to, with a delete action", () => {
    const sections = buildInferenceSections(input());
    const personaSection = sections.find((section) => section.id === "persona-5")!;
    const memories = personaSection.items.filter((item) => item.id.startsWith("memory-"));
    expect(memories).toHaveLength(3);
    expect(memories.find((item) => item.labelKey === "inference.field.memoriesSaid")?.detail).toContain("面");
    expect(memories.every((item) => item.action?.kind === "deleteMemory")).toBe(true);
  });

  it("says something about me, and says where it came from", () => {
    const sections = buildInferenceSections(input());
    const me = sections.find((section) => section.id === "me")!;
    expect(me.titleKey).toBe("inference.sectionMe");
    const labels = me.items.map((item) => item.labelKey);
    expect(labels).toContain("inference.me.addressStyle");
    expect(labels).toContain("inference.me.userSide");
    expect(labels).toContain("inference.me.mirror");
    expect(labels).toContain("inference.me.mood");
    expect(labels).toContain("inference.me.checkin");
    expect(labels).toContain("inference.me.safety");
    expect(labels).toContain("inference.me.memories");
    expect(labels).toContain("inference.me.trajectory");
    expect(me.items.find((item) => item.labelKey === "inference.me.mood")?.source).toBe("written");
    expect(me.items.find((item) => item.labelKey === "inference.me.safety")?.source).toBe("mined");
    expect(me.items.find((item) => item.labelKey === "inference.me.trajectory")?.evidence?.[0]).toContain("stable");
  });

  it("returns an empty persona section rather than hiding it", () => {
    const sections = buildInferenceSections({
      user: {},
      personas: [{
        persona: { id: 9, name: "空", personaData: {}, styleProfile: null, settings: null },
        memories: [],
      }],
    });
    expect(sections[1]!.id).toBe("persona-9");
    expect(sections[1]!.items).toEqual([]);
    expect(personaHasMeasurements({ persona: { id: 9, name: "空", personaData: {}, styleProfile: null, settings: null }, memories: [] })).toBe(false);
  });

  it("does not include one persona's data in another's section", () => {
    const base = input();
    const other = {
      persona: { id: 6, name: "阿凯", personaData: {}, styleProfile: null, settings: null },
      memories: [],
    };
    const sections = buildInferenceSections({ ...base, personas: [...base.personas, other] });
    const second = sections.find((section) => section.id === "persona-6")!;
    expect(second.titleParams).toEqual({ name: "阿凯" });
    expect(second.items).toEqual([]);
    const first = sections.find((section) => section.id === "persona-5")!;
    expect(first.items.some((item) => item.labelParams?.name === "阿凯")).toBe(false);
  });
});
