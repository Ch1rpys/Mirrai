/**
 * Writing one persona's line in a group (C9.8).
 *
 * The same planner and executor as every other reply, with the room's
 * instruction, the room's context, and the group surface's length and
 * projection. Nothing here writes to the pair's conversation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupMessage, Persona } from "../../drizzle/schema";
import type { GroupStats } from "@shared/group-stats";

const planTurn = vi.fn();
const executePlan = vi.fn();
const resolveProviderForPurpose = vi.fn();

vi.mock("../chat/generate", () => ({
  planTurn: (...args: unknown[]) => planTurn(...args),
  executePlan: (...args: unknown[]) => executePlan(...args),
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForPurpose: (...args: unknown[]) => resolveProviderForPurpose(...args),
}));

import {
  composeGroupReply,
  groupContextMessages,
  groupLengthCap,
  type ComposeGroupReplyParams,
} from "./reply";
import { groupOverlayText } from "./turns";
import { buildSystemPromptParts } from "../_core/persona-utils";

const groupStats: GroupStats = {
  samples: 120,
  afterMeRate: 0.6,
  afterOthersRate: 0.2,
  lengthMedian: 5,
  gapMedianMessages: 5,
};

const publicFingerprint = {
  version: 1,
  samples: 60,
  turnChars: { median: 5, p95: 9, max: 20 },
  endings: {},
  particles: {},
  laugh: {},
  emoji: {},
  punctuation: {},
  asking: {},
  newlineRate: 0,
  stateDistribution: {},
};

function persona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 1,
    userId: 7,
    name: "小满",
    analysisStatus: "ready",
    emotionalState: "warm",
    timezone: "Asia/Shanghai",
    presence: "active",
    graduationStatus: null,
    styleProfile: {
      version: 1,
      measuredAt: "2024-01-01T00:00:00.000Z",
      recordsVersion: "100:100",
      fingerprint: publicFingerprint,
      publicFingerprint,
      group: groupStats,
    },
    settings: {},
    personaData: {},
    chatCount: 3,
    ...overrides,
  } as unknown as Persona;
}

function message(
  id: number,
  role: "user" | "assistant",
  content: string,
  personaId?: number,
): GroupMessage {
  return {
    id,
    roomId: 3,
    userId: 7,
    role,
    personaId: personaId ?? null,
    content,
    metadata: null,
    createdAt: new Date(`2024-05-01T21:0${id}:00.000Z`),
  } as GroupMessage;
}

const history: GroupMessage[] = [
  message(1, "user", "在吗"),
  message(2, "assistant", "在的呀", 1),
  message(3, "assistant", "我也在", 2),
  message(4, "user", "今天好累"),
];

function params(overrides: Partial<ComposeGroupReplyParams> = {}): ComposeGroupReplyParams {
  return {
    persona: persona(),
    userId: 7,
    userName: "阿树",
    members: [
      { personaId: 1, name: "小满" },
      { personaId: 2, name: "阿凯" },
    ],
    history,
    locale: "zh",
    now: new Date("2024-05-01T21:05:00.000Z"),
    seed: "group:3:4",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveProviderForPurpose.mockResolvedValue({ name: "stub" });
  planTurn.mockResolvedValue({ kind: "model", messages: [], layersUsed: [], maxTokens: 40 });
  executePlan.mockImplementation(async function* () {
    yield { type: "final", text: " 累就歇会儿 ", projection: [] };
    return;
  });
});

describe("the room's context", () => {
  it("keeps the persona's own lines as assistant and names everyone else", () => {
    const context = groupContextMessages(params());
    expect(context).toEqual([
      { role: "user", content: "阿树：在吗" },
      { role: "assistant", content: "在的呀" },
      { role: "user", content: "阿凯：我也在" },
      { role: "user", content: "阿树：今天好累" },
    ]);
  });
});

describe("the length cap", () => {
  it("is a little above the group median", () => {
    expect(groupLengthCap(5)).toBe(13);
    expect(groupLengthCap(2)).toBe(12);
    expect(groupLengthCap(100)).toBe(250);
    expect(groupLengthCap(null)).toBeNull();
  });
});

describe("composeGroupReply", () => {
  it("plans with the room instruction, the given history and the group surface", async () => {
    const reply = await composeGroupReply(params());
    expect(reply).toBe("累就歇会儿");

    const input = planTurn.mock.calls[0]![0] as Record<string, any>;
    expect(input.providedHistoryOnly).toBe(true);
    expect(input.userMessage).toBe("今天好累");
    expect(input.groupOverlay).toBe(
      groupOverlayText({ locale: "zh", members: ["小满", "阿凯"], userName: "阿树" }),
    );
    expect(input.groupOverlay).toContain("小满");
    expect(input.groupOverlay).toContain("阿凯");
    expect(input.groupStyle.fingerprint).toBe(publicFingerprint);
    expect(input.groupStyle.maxChars).toBe(13);
    // The expensive optional layers would multiply the model calls.
    expect(input.layerOverrides).toEqual({
      twoStage: false,
      rerank: false,
      factRewrite: false,
      fingerprintRerank: false,
    });
    expect(input.history).toEqual([
      { role: "user", content: "阿树：在吗" },
      { role: "assistant", content: "在的呀" },
      { role: "user", content: "阿凯：我也在" },
      { role: "user", content: "阿树：今天好累" },
    ]);

    // The executor gets the same turn input, and one non-streaming call.
    const executedInput = executePlan.mock.calls[0]![1] as Record<string, any>;
    expect(executedInput.groupOverlay).toBe(input.groupOverlay);
    expect(executedInput.providedHistoryOnly).toBe(true);
    const io = executePlan.mock.calls[0]![2] as Record<string, any>;
    expect(io.mode).toBe("once");
    expect(io.rerank).toBe(false);
  });

  it("falls back to the stored fingerprint when there is no public one", async () => {
    const bare = persona({ styleProfile: { version: 1, measuredAt: "x", recordsVersion: "1:1", fingerprint: publicFingerprint } } as unknown as Partial<Persona>);
    await composeGroupReply(params({ persona: bare }));
    const input = planTurn.mock.calls[0]![0] as Record<string, any>;
    expect(input.groupStyle.fingerprint).toBeNull();
  });

  it("measures the room's length from the group profile", async () => {
    const long = persona({
      styleProfile: {
        version: 1,
        measuredAt: "x",
        recordsVersion: "1:1",
        group: { ...groupStats, lengthMedian: 40 },
      },
    } as unknown as Partial<Persona>);
    await composeGroupReply(params({ persona: long }));
    const input = planTurn.mock.calls[0]![0] as Record<string, any>;
    expect(input.groupStyle.maxChars).toBe(100);
  });

  it("says nothing when the persona is not ready", async () => {
    const reply = await composeGroupReply(
      params({ persona: persona({ analysisStatus: "analyzing" } as unknown as Partial<Persona>) }),
    );
    expect(reply).toBeNull();
    expect(planTurn).not.toHaveBeenCalled();
  });

  it("says nothing when no provider is configured", async () => {
    resolveProviderForPurpose.mockResolvedValue(undefined);
    const reply = await composeGroupReply(params());
    expect(reply).toBeNull();
    expect(planTurn).not.toHaveBeenCalled();
  });

  it("says nothing when the model returns nothing", async () => {
    executePlan.mockImplementation(async function* () {
      yield { type: "final", text: "   ", projection: [] };
      return;
    });
    expect(await composeGroupReply(params())).toBeNull();
  });
});

describe("the room instruction in the real prompt", () => {
  it("is an instruction outside the material fence", () => {
    const overlay = groupOverlayText({
      locale: "zh",
      members: ["小满", "阿凯"],
      userName: "阿树",
    });
    const built = buildSystemPromptParts(persona(), {
      locale: "zh",
      now: new Date("2024-05-01T21:05:00.000Z"),
      groupOverlay: overlay,
    });
    const prompt = built.prompt;
    expect(prompt).toContain(overlay);
    // The instruction is before the fenced material, and it is not itself
    // inside a `<persona_data>` block.
    const overlayAt = prompt.indexOf(overlay);
    const firstFence = prompt.indexOf("<persona_data>");
    expect(overlayAt).toBeGreaterThan(-1);
    expect(firstFence).toBeGreaterThan(overlayAt);
    const before = prompt.slice(0, overlayAt);
    expect(before.split("<persona_data>").length).toBe(before.split("</persona_data>").length);
  });

  it("leaves the prompt unchanged when there is no group overlay", () => {
    const withNone = buildSystemPromptParts(persona(), { locale: "zh" }).prompt;
    expect(withNone).not.toContain("这是一个群");
  });
});
