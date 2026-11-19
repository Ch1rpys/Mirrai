import { describe, expect, it } from "vitest";
import {
  applyClarification,
  measureClarifyCounts,
  pickClarifications,
  type Clarification,
  type ClarifyCounts,
  type ClarifyPersonaSlice,
} from "./clarify";
import { copy } from "./copy";
import type { MicroRule } from "./micro-rules";
import { normalizeStyleProfile } from "./style-profile";

const emptyCounts: ClarifyCounts = {
  distantLines: 0,
  melancholyLines: 0,
  laughSamples: 0,
  conflictCount: 0,
};

const candidate: MicroRule = {
  id: "r-one",
  trigger: ["随便你"],
  meaning: "真的生气了",
  rendering: "更短、更冷",
  confidence: 0.6,
  source: "auto",
  verified: false,
  evidence: [{ snippet: "随便你" }],
};

function pick(
  overrides: {
    personaData?: ClarifyPersonaSlice;
    styleProfile?: ReturnType<typeof normalizeStyleProfile>;
    counts?: Partial<ClarifyCounts>;
  } = {},
) {
  return pickClarifications({
    name: "小满",
    locale: "zh",
    personaData: overrides.personaData ?? {},
    styleProfile: overrides.styleProfile,
    counts: { ...emptyCounts, ...overrides.counts },
  });
}

function question(kind: Clarification["kind"], extra: Partial<Clarification> = {}): Clarification {
  return {
    id: extra.id ?? kind,
    kind,
    prompt: "",
    input: "text",
    ...extra,
  };
}

describe("when each question is asked", () => {
  it("asks for a usual name only when the fingerprint has none", () => {
    expect(pick().some((row) => row.id === "address_normal")).toBe(true);
    expect(
      pick({
        styleProfile: normalizeStyleProfile({ fingerprint: { address: { 满满: 0.2 } } }),
      }).some((row) => row.id === "address_normal"),
    ).toBe(false);
  });

  it("asks the angry questions only when distant lines are few", () => {
    expect(pick().some((row) => row.id === "address_angry")).toBe(true);
    expect(pick().some((row) => row.id === "period_angry")).toBe(true);
    expect(
      pick({ counts: { distantLines: 20 } }).some((row) => row.id === "address_angry"),
    ).toBe(false);
    expect(
      pick({ counts: { distantLines: 20 } }).some((row) => row.id === "period_angry"),
    ).toBe(false);
  });

  it("asks how they laugh only when laughs are few", () => {
    expect(pick().some((row) => row.id === "laugh_form")).toBe(true);
    expect(
      pick({ counts: { laughSamples: 10 } }).some((row) => row.id === "laugh_form"),
    ).toBe(false);
  });

  it("asks for a goodnight reply only when none was measured", () => {
    expect(pick().some((row) => row.id === "goodnight")).toBe(true);
    expect(
      pick({
        styleProfile: normalizeStyleProfile({
          rituals: [{ cue: "晚安", reply: "晚安呀" }],
        }),
      }).some((row) => row.id === "goodnight"),
    ).toBe(false);
  });

  it("asks what they do when you are sad only when melancholy lines are few", () => {
    expect(pick().some((row) => row.id === "when_sad")).toBe(true);
    expect(
      pick({ counts: { melancholyLines: 20 } }).some((row) => row.id === "when_sad"),
    ).toBe(false);
  });

  it("asks who speaks first only when conflicts are few", () => {
    expect(pick().some((row) => row.id === "conflict_first")).toBe(true);
    expect(
      pick({ counts: { conflictCount: 3 } }).some((row) => row.id === "conflict_first"),
    ).toBe(false);
  });

  it("prefers the measured conflict profile over the repair-act count", () => {
    const measured = normalizeStyleProfile({
      conflict: {
        episodes: 6,
        durationMin: { median: 300, p25: 240, p75: 360, all: [180, 240, 300, 300, 360, 480] },
        repairBy: { them: 4, me: 2 },
        repairAcceptRate: 1,
        repairLines: ["好啦 不气了"],
        coldLines: ["哦。", "随便。"],
      },
    });
    const ids = pick({
      counts: { conflictCount: 0 },
      styleProfile: measured,
    }).map((row) => row.id);
    expect(ids).not.toContain("conflict_first");
  });

  it("asks about stickers only when none were counted", () => {
    expect(pick().some((row) => row.id === "sticker_habit")).toBe(true);
    expect(
      pick({
        styleProfile: normalizeStyleProfile({ stickers: { rate: 0.1 } }),
      }).some((row) => row.id === "sticker_habit"),
    ).toBe(false);
  });

  it("always asks what they never say and what they avoid", () => {
    const ids = pick({
      styleProfile: normalizeStyleProfile({
        fingerprint: { address: { 满满: 0.2 } },
        rituals: [{ cue: "晚安", reply: "晚安" }],
        stickers: { rate: 0 },
      }),
      counts: {
        distantLines: 20,
        melancholyLines: 20,
        laughSamples: 10,
        conflictCount: 3,
      },
    }).map((row) => row.id);
    expect(ids).toContain("never_says");
    expect(ids).toContain("avoid_topic");
  });

  it("asks to confirm a candidate that has only one piece of evidence", () => {
    expect(
      pick({ personaData: { microRules: [candidate] } }).some(
        (row) => row.id === "confirm_rule:r-one",
      ),
    ).toBe(true);
    expect(
      pick({
        personaData: {
          microRules: [{ ...candidate, verified: true }],
        },
      }).some((row) => row.kind === "confirm_rule"),
    ).toBe(false);
    expect(
      pick({
        personaData: {
          microRules: [{ ...candidate, evidence: [{ snippet: "a" }, { snippet: "b" }] }],
        },
      }).some((row) => row.kind === "confirm_rule"),
    ).toBe(false);
  });
});

describe("a persona whose records already cover the gaps", () => {
  it("is only asked what they never say, what they avoid, and maybe a rule", () => {
    const ids = pick({
      personaData: { nickname: "满满", microRules: [candidate] },
      styleProfile: normalizeStyleProfile({
        fingerprint: { address: { 满满: 0.2 } },
        rituals: [{ cue: "晚安", reply: "晚安呀" }],
        stickers: { rate: 0.05 },
      }),
      counts: {
        distantLines: 236,
        melancholyLines: 40,
        laughSamples: 20,
        conflictCount: 6,
      },
    }).map((row) => row.id);
    expect(ids).toEqual(["never_says", "avoid_topic", "confirm_rule:r-one"]);
  });
});

describe("what an answer writes", () => {
  const style = normalizeStyleProfile(null);

  it("writes a usual name only over the default nickname", () => {
    const overDefault = applyClarification(question("address_normal"), "阿树", {
      personaData: { nickname: copy("zh", "labels.persona.fallbackNickname") },
      styleProfile: style,
    });
    expect(overDefault?.personaData.nickname).toBe("阿树");
    const keep = applyClarification(question("address_normal"), "阿树", {
      personaData: { nickname: "满满" },
      styleProfile: style,
    });
    expect(keep?.personaData.nickname).toBe("满满");
  });

  it("writes an angry-name rule, or nothing when it is the same as usual", () => {
    const written = applyClarification(question("address_angry"), "喂", {
      personaData: {},
      styleProfile: style,
    });
    expect(written?.personaData.microRules?.[0]).toMatchObject({
      source: "manual",
      verified: true,
      trigger: ["喂"],
      meaning: "生气",
    });
    const same = applyClarification(question("address_angry"), "和平时一样", {
      personaData: {},
      styleProfile: style,
    });
    expect(same?.personaData.microRules ?? []).toEqual([]);
  });

  it("adds a distant full-stop note only when the answer is yes", () => {
    const yes = applyClarification(question("period_angry"), "会", {
      personaData: {},
      styleProfile: style,
    });
    expect(yes?.personaData.imperfectionProfile).toEqual([
      { state: "distant", deviations: ["句末带句号"] },
    ]);
    const no = applyClarification(question("period_angry"), "不会", {
      personaData: {},
      styleProfile: style,
    });
    expect(no?.personaData.imperfectionProfile ?? []).toEqual([]);
  });

  it("adds a laugh to the catchphrases", () => {
    const written = applyClarification(question("laugh_form"), "哈哈哈", {
      personaData: { catchphrases: ["嗯嗯"] },
      styleProfile: style,
    });
    expect(written?.personaData.catchphrases).toEqual(["嗯嗯", "哈哈哈"]);
  });

  it("adds a handwritten goodnight ritual", () => {
    const written = applyClarification(question("goodnight"), "晚安呀", {
      personaData: {},
      styleProfile: style,
    });
    expect(written?.styleProfile.rituals).toEqual([
      {
        trigger: "晚安",
        variants: ["晚安"],
        n: 1,
        replies: [{ text: "晚安呀", n: 1, recordId: 0 }],
        coverage: 1,
        manual: true,
      },
    ]);
  });

  it("writes the chosen sad-day rule", () => {
    const written = applyClarification(question("when_sad"), "陪着不多说", {
      personaData: {},
      styleProfile: style,
    });
    expect(written?.personaData.microRules?.[0]).toMatchObject({
      source: "manual",
      verified: true,
      trigger: ["难过", "不开心"],
      rendering: "陪着不多说",
    });
  });

  it("writes who speaks first after a fight", () => {
    const written = applyClarification(question("conflict_first"), "我", {
      personaData: {},
      styleProfile: style,
      name: "小满",
    });
    expect(written?.personaData.microRules?.[0]?.rendering).toBe("一般是我先开口");
  });

  it("writes a sticker rate", () => {
    const written = applyClarification(question("sticker_habit"), "偶尔", {
      personaData: {},
      styleProfile: style,
    });
    expect(written?.styleProfile.stickers).toEqual({ manualRate: 0.1 });
  });

  it("writes a never-say subtraction and an avoided topic", () => {
    const never = applyClarification(question("never_says"), "加油", {
      personaData: {},
      styleProfile: style,
    });
    expect(never?.personaData.suppressions?.[0]).toMatchObject({
      kind: "no_phrase",
      pattern: "加油",
      source: "manual",
      verified: true,
    });
    const avoid = applyClarification(question("avoid_topic"), "前任", {
      personaData: {},
      styleProfile: style,
    });
    expect(avoid?.personaData.suppressions?.[0]).toMatchObject({
      kind: "avoid_topic",
      pattern: "前任",
    });
  });

  it("confirms or drops a one-evidence rule", () => {
    const yes = applyClarification(
      question("confirm_rule", { id: "confirm_rule:r-one", ruleId: "r-one" }),
      "是",
      { personaData: { microRules: [candidate] }, styleProfile: style },
    );
    expect(yes?.personaData.microRules?.[0]?.verified).toBe(true);
    const no = applyClarification(
      question("confirm_rule", { id: "confirm_rule:r-one", ruleId: "r-one" }),
      "不是",
      { personaData: { microRules: [candidate] }, styleProfile: style },
    );
    expect(no?.personaData.microRules).toEqual([]);
    expect(no?.personaData.rejectedFeedbackKeys).toEqual(["rule:r-one"]);
  });

  it("writes nothing for unsure, except that the question was asked", () => {
    const patch = applyClarification(question("never_says"), "不确定", {
      personaData: { nickname: "满满" },
      styleProfile: style,
    });
    expect(patch?.personaData.suppressions ?? []).toEqual([]);
    expect(patch?.personaData.clarified).toEqual(["never_says"]);
  });
});

describe("counting gaps in the records", () => {
  it("counts distant lines, laughs and repairs on their text", () => {
    expect(
      measureClarifyCounts([
        { role: "assistant", kind: "text", content: "哈哈", emotion: "distant", act: "repair" },
        { role: "user", kind: "text", content: "哈哈", emotion: "distant", act: "repair" },
        { role: "assistant", kind: "sticker", content: "哈哈", emotion: "distant" },
      ]),
    ).toEqual({
      distantLines: 1,
      melancholyLines: 0,
      laughSamples: 1,
      conflictCount: 1,
    });
  });
});
