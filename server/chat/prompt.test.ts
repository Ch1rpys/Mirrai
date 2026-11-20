import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The one prompt.
 *
 * The conversation and the "show me the system prompt" button used to
 * build their prompts separately, so the button showed something the
 * conversation never used. They are now the same builder — and this test
 * is what says so.
 */
const retrieveMemories = vi.fn();
const getLatestChatSummary = vi.fn();
const getUserById = vi.fn();
const getRecentUserMood = vi.fn();
const getRelationshipEvents = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getCollectedMessagesForPersona = vi.fn();
const getRecordsByIds = vi.fn();

vi.mock("../db", () => ({
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersona(...a),
  getRecordsByIds: (...a: unknown[]) => getRecordsByIds(...a),
}));

// The retrieval is the part that reaches into the database; the
// formatters are the part that turns a memory into a line of prompt, and
// they are worth keeping real.
vi.mock("./retrieval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retrieval")>();
  return {
    ...actual,
    retrieveMemories: (...a: unknown[]) => retrieveMemories(...a),
  };
});

import { actProfileForTurn, buildPromptForPersona } from "./prompt";
import { copy } from "@shared/copy";
import { buildSystemPrompt } from "../_core/persona-utils";

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "warm",
  timezone: "Asia/Shanghai",
  relationshipDesc: "前女友",
  togetherFrom: "2021-06-15",
  togetherTo: null,
  personaData: { personality: "温柔", speakingStyle: "慢慢说" },
} as any;

describe("the prompt the persona is given", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieveMemories.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    getUserById.mockResolvedValue({ name: "小李", timezone: "Asia/Shanghai" });
    getRecentUserMood.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getCollectedMessagesForPersona.mockResolvedValue([]);
    getRecordsByIds.mockResolvedValue([]);
  });

  it("never puts the public voice into a one-to-one prompt", async () => {
    const built = await buildPromptForPersona({
      persona: {
        ...persona,
        personaData: {
          ...persona.personaData,
          publicVoice: "PUBLIC-VOICE-ONLY",
        },
      },
      userId: 1,
    });
    expect(built).not.toContain("PUBLIC-VOICE-ONLY");
  });

  it("is the same prompt the preview shows", async () => {
    const built = await buildPromptForPersona({ persona, userId: 1 });
    const preview = buildSystemPrompt(persona, {});

    // The preview button and the conversation must not drift apart. The
    // sections that depend on the database are the difference; the
    // persona's own instructions must be identical.
    for (const marker of ["【性格特质】", "【说话方式】", "【对话原则】", "【底线】"]) {
      expect(built).toContain(marker);
      expect(preview).toContain(marker);
    }
  });

  it("adds the meeting countdown only when a date is set (C5.1)", async () => {
    const withDate = await buildPromptForPersona({
      persona: { ...persona, settings: { ldr: { nextMeetAt: "2026-03-02", weather: false } } },
      userId: 1,
      now: new Date("2026-03-01T12:00:00Z"),
    });
    expect(withDate).toContain(copy("zh", "prompt.nextMeet", { date: "2026-03-02", days: 1 }));

    const onTheDay = await buildPromptForPersona({
      persona: { ...persona, settings: { ldr: { nextMeetAt: "2026-03-02", weather: false } } },
      userId: 1,
      now: new Date("2026-03-02T04:00:00Z"),
    });
    expect(onTheDay).toContain(copy("zh", "prompt.nextMeetToday"));

    const without = await buildPromptForPersona({ persona, userId: 1 });
    expect(without).not.toContain("约好 2026-03-02 见面");
    expect(without).not.toContain("约好今天见面");
  });

  it("puts the persona's own instructions in it", async () => {
    const built = await buildPromptForPersona({ persona, userId: 1 });
    expect(built).toContain("温柔");
    expect(built).toContain("小A");
  });

  it("writes in the language it is asked for", async () => {
    const chinese = await buildPromptForPersona({ persona, userId: 1, locale: "zh" });
    const english = await buildPromptForPersona({ persona, userId: 1, locale: "en" });

    expect(chinese).toContain("【底线】");
    expect(english).toContain("Lines that do not move");
    expect(english).toContain("【How to talk】");
    // The persona's own words stay in the language they were written in.
    expect(english).toContain("温柔");
  });

  it("includes the anchors and the memories it was given", async () => {
    retrieveMemories.mockResolvedValue([
      { id: 1, title: "她的生日", description: "11月3日", category: "anchor", subject: "them" },
      { id: 2, title: "第一次见面", description: "图书馆门口", category: "memory", subject: "them" },
    ]);

    const built = await buildPromptForPersona({ persona, userId: 1 });

    expect(built).toContain("她的生日");
    expect(built).toContain("第一次见面");
  });

  it("carries the persona's rules and imperfection", async () => {
    // The evaluation harness measures the persona with and without its
    // rules, and it does that by switching them off *here*. So the
    // switch has to reach the prompt builder — a switch that stopped
    // at the boundary would silently measure the same persona twice.
    const withRules = await buildPromptForPersona({
      persona: {
        ...persona,
        personaData: {
          ...persona.personaData,
          microRules: [
            {
              id: "r1",
              trigger: ["随便你"],
              meaning: "她真的生气了",
              rendering: "更短、更冷",
              confidence: 1,
              source: "manual",
              verified: true,
              evidence: [],
            },
          ],
          imperfectionProfile: [{ state: "distant", deviations: ["极短句"] }],
        },
      },
      userId: 1,
    });
    expect(withRules).toContain("随便你");

    const withoutRules = await buildPromptForPersona({
      persona: {
        ...persona,
        personaData: {
          ...persona.personaData,
          microRules: [
            {
              id: "r1",
              trigger: ["随便你"],
              meaning: "她真的生气了",
              rendering: "更短、更冷",
              confidence: 1,
              source: "manual",
              verified: true,
              evidence: [],
            },
          ],
        },
      },
      userId: 1,
      microRules: null,
      imperfectionProfile: null,
    });
    expect(withoutRules).not.toContain("随便你");
  });

  it("carries the scene it is in", async () => {
    const built = await buildPromptForPersona({
      persona,
      userId: 1,
      sceneOverlay: "你们在一家旧书店里。",
    });
    expect(built).toContain("【当前场景】");
    expect(built).toContain("你们在一家旧书店里。");
  });

  it("puts both sides of a memory conflict in the prompt and does not force a mention", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      { id: 1, title: "那家店", description: "在海边", factKey: "那家店", status: "active" },
      { id: 2, title: "那家店", description: "在山上", factKey: "那家店", status: "active" },
    ]);
    const built = await buildPromptForPersona({ persona, userId: 1, locale: "zh" });
    expect(built).toContain("这两条对不上");
    expect(built).toContain("在海边");
    expect(built).toContain("在山上");
    expect(built).toContain("不是每轮都要说");
  });

  it("does not mention a conflict that has already been decided", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      { id: 1, title: "那家店", description: "在海边", factKey: "那家店", status: "active" },
      { id: 2, title: "那家店", description: "在山上", factKey: "那家店", status: "superseded" },
    ]);
    const built = await buildPromptForPersona({ persona, userId: 1, locale: "zh" });
    expect(built).not.toContain("这两条对不上");
  });
});

describe("a stretch of the same person", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieveMemories.mockResolvedValue([]);
    getLatestChatSummary.mockResolvedValue(null);
    getUserById.mockResolvedValue({ name: "小李", timezone: "Asia/Shanghai" });
    getRecentUserMood.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    getCollectedMessagesForPersona.mockResolvedValue([]);
    getRecordsByIds.mockResolvedValue([]);
  });

  it("uses that stretch's action counts, not the current ones", () => {
    const early = { samples: 40, unconditional: { acknowledge: 30 }, buckets: [] };
    const late = { samples: 40, unconditional: { logistics: 30 }, buckets: [] };
    const withPeriods = {
      ...persona,
      personaData: {
        actProfile: late,
        periods: [
          { id: "period-1", from: "2025-01-01", to: "2025-02-01", actProfileDelta: early },
          { id: "period-2", from: "2025-03-01", to: "2025-04-01", actProfileDelta: late },
        ],
      },
    };

    expect(actProfileForTurn(withPeriods, "period-1")).toEqual(early);
    expect(actProfileForTurn(withPeriods, "period-2")).toEqual(late);
    expect(actProfileForTurn(withPeriods, null)).toEqual(late);
  });

  it("does not tell the earlier stretch that they have already parted", async () => {
    const withPeriods = {
      ...persona,
      togetherTo: "2022-08-01",
      personaData: {
        ...persona.personaData,
        periods: [
          { id: "period-1", from: "2022-01-01", to: "2022-06-01" },
          { id: "period-2", from: "2022-07-01", to: "2023-01-01" },
        ],
      },
    };
    getRelationshipEvents.mockResolvedValue([
      { kind: "together", title: "在一起", happenedAt: new Date("2022-02-01T00:00:00Z") },
      { kind: "breakup", title: "分手了", happenedAt: new Date("2022-08-01T00:00:00Z") },
    ]);
    const current = await buildPromptForPersona({ persona: withPeriods, userId: 1, locale: "zh" });
    expect(current).toContain("你们已经分开了");
    expect(current).not.toContain("你现在是 2022-01-01 到 2022-06-01 那段时间的自己");

    const earlier = await buildPromptForPersona({
      persona: withPeriods,
      userId: 1,
      locale: "zh",
      periodId: "period-1",
    });
    expect(earlier).not.toContain("你们已经分开了");
    expect(earlier).toContain("你现在是 2022-01-01 到 2022-06-01 那段时间的自己");
    const fenced = /<persona_data>[\s\S]*?<\/persona_data>/g;
    expect(earlier.replace(fenced, "")).toContain("那之后发生的任何事你都不知道");
  });

  it("keeps memories from inside the stretch, drops later ones, and keeps a pin", async () => {
    retrieveMemories.mockResolvedValue([
      {
        id: 1,
        title: "时期内的事",
        description: "春天",
        category: "memory",
        date: "2022-03-01",
        isPinned: false,
        subject: "them",
      },
      {
        id: 2,
        title: "时期之后的事",
        description: "秋天",
        category: "memory",
        date: "2022-08-15",
        isPinned: false,
        subject: "them",
      },
      {
        id: 3,
        title: "置顶",
        description: "一直记得",
        category: "memory",
        date: "2022-09-01",
        isPinned: true,
        subject: "them",
      },
    ]);
    const withPeriods = {
      ...persona,
      personaData: {
        ...persona.personaData,
        periods: [{ id: "period-1", from: "2022-01-01", to: "2022-06-01" }],
      },
    };
    const built = await buildPromptForPersona({
      persona: withPeriods,
      userId: 1,
      locale: "zh",
      periodId: "period-1",
    });
    expect(built).toContain("时期内的事");
    expect(built).toContain("置顶");
    expect(built).not.toContain("时期之后的事");
  });

  it("drops a record from the next morning in the persona's zone", async () => {
    retrieveMemories.mockResolvedValue([
      {
        id: 8,
        title: "第二天清晨的事",
        description: "刚过午夜",
        category: "memory",
        date: null,
        recordId: 4,
        isPinned: false,
        subject: "them",
      },
    ]);
    getRecordsByIds.mockResolvedValue([
      { id: 4, timestamp: new Date("2022-06-01T16:30:00.000Z") },
    ]);
    const withPeriods = {
      ...persona,
      personaData: {
        ...persona.personaData,
        periods: [{ id: "period-1", from: "2022-01-01", to: "2022-06-01" }],
      },
    };
    const built = await buildPromptForPersona({
      persona: withPeriods,
      userId: 1,
      locale: "zh",
      periodId: "period-1",
    });
    expect(built).not.toContain("第二天清晨的事");
  });

  it("keeps something the persona said out of the anchor block", async () => {
    retrieveMemories.mockResolvedValue([
      {
        id: 1,
        title: "周三下午有课",
        description: "我周三下午有课",
        category: "anchor",
        subject: "said",
        date: null,
        isPinned: false,
      },
      {
        id: 2,
        title: "生日是5月21号",
        description: "她说过",
        category: "anchor",
        subject: "them",
        date: "2022-05-21",
        isPinned: false,
      },
    ]);
    const built = await buildPromptForPersona({ persona, userId: 1, locale: "zh" });
    const anchorAt = built.indexOf("【事实锚点（不得违背）】");
    const memoryAt = built.indexOf("【相关记忆】");
    expect(anchorAt).toBeGreaterThan(-1);
    expect(memoryAt).toBeGreaterThan(anchorAt);
    const anchorBlock = built.slice(anchorAt, memoryAt);
    expect(anchorBlock).toContain("生日是5月21号");
    expect(anchorBlock).not.toContain("周三下午有课");
    expect(built).toContain("这是你在这里说过的话，不是记录里的事实");
    expect(built).toContain("周三下午有课");
  });
});

describe("the turning points stay out of the prompt", () => {
  it("never puts the timeline's markers or notes into the persona's words", async () => {
    const prompt = await buildPromptForPersona({
      persona: {
        ...persona,
        personaData: {
          ...persona.personaData,
          turningPoints: [{
            id: "2023-W29",
            at: "2023-W29",
            changes: [{ series: "charsMedian", before: 10, after: 6 }],
            status: "confirmed",
            note: "MARKER-TURN-NOTE",
          }],
        },
      },
      userId: 1,
      userMessage: "在吗",
    });
    expect(prompt).not.toContain("MARKER-TURN-NOTE");
    expect(prompt).not.toContain("2023-W29");
    expect(prompt).not.toContain("charsMedian");
  });
});
