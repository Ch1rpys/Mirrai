import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The videos in a distillation (B7.10).
 *
 * The pipeline takes the frames and the words the router prepared and
 * has to put them where the model reads them: the frames go to the
 * vision step, and the transcript goes into the analysis text inside a
 * fence. A run with frames but no transcript — no local speech engine —
 * still describes the pictures and does not fail.
 */

const invoke = vi.fn();
const invokeForUser = vi.fn();
const invokeForUserWithReason = vi.fn();
const resolveProviderForUser = vi.fn();
const updateSkillJob = vi.fn();
const updatePersona = vi.fn();
const createSkillJob = vi.fn();
const runPythonTool = vi.fn();
const loadPrompt = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invoke(...a),
  },
  invokeForUser: (...a: unknown[]) => invokeForUser(...a),
  invokeForUserWithReason: (...a: unknown[]) => invokeForUserWithReason(...a),
}));

vi.mock("../db", () => ({
  getSkillJobById: vi.fn().mockResolvedValue(undefined),
  updateSkillJob: (...a: unknown[]) => updateSkillJob(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  createSkillJob: (...a: unknown[]) => createSkillJob(...a),
  getFilesByPersonaId: vi.fn().mockResolvedValue([]),
  createChatSummary: vi.fn(),
  iterateRecords: async function* () {},
  createDistillationChunk: vi.fn(),
  createDistillationCard: vi.fn(),
  getRecordsVersion: vi.fn().mockResolvedValue("0:0"),
}));

vi.mock("./runner", () => ({
  runPythonTool: (...a: unknown[]) => runPythonTool(...a),
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
  resolveProviderForPurpose: (...a: unknown[]) => resolveProviderForUser(...a),
  resolveProviderForPurposeWithOwnership: async (params: unknown) => ({
    provider: await resolveProviderForUser(params as any),
    owned: false,
  }),
}));

vi.mock("./prompts", () => ({
  loadPrompt: (...a: unknown[]) => loadPrompt(...a),
}));

vi.mock("./celebrity", () => ({
  resolveCelebrityProfile: (family: string, profile?: string | null) => ({
    profile: family === "celebrity" ? profile ?? null : null,
    hasResearchStages: false,
  }),
  runCelebrityResearch: vi.fn().mockResolvedValue(null),
  runQualityCheck: vi.fn().mockResolvedValue(null),
  sanitizeForCopyright: (text: string) => text,
  saveResearchProfile: vi.fn(),
  AGENTIC_PROTOCOL: "",
}));

import { runSkillPipeline } from "./pipeline";

/** The persona data the structurer is expected to return. */
const PERSONA_JSON = JSON.stringify({
  personality: "温柔",
  speakingStyle: "简短",
  catchphrases: ["嗯"],
  nickname: "宝",
  attachmentStyle: "安全型",
  loveLanguage: "陪伴",
  conflictStyle: "冷战",
  touchingMoments: "一次旅行",
  memories: "很多回忆",
  summary: "一个温柔的人",
});

const baseInput = {
  personaId: 1,
  userId: 1,
  characterFamily: "relationship" as const,
  name: "小A",
  chatContent: "我们昨天见面了。",
};

const FRAMES = ["FRAME0", "FRAME1", "FRAME2"].map(
  (frame) => `data:image/jpeg;base64,${frame}`,
);

/** The image URLs the vision stage was given. */
function describedImageUrls(): string[] {
  return invoke.mock.calls
    .flatMap((call) => {
      const content = (call[0] as any)?.messages?.[0]?.content;
      if (!Array.isArray(content)) return [];
      return content
        .filter((part: any) => part?.type === "image_url")
        .map((part: any) => String(part.url));
    });
}

/** Everything the model was told, joined. */
function allPromptText(): string {
  return invoke.mock.calls
    .flatMap((call) => {
      const messages = (call[0] as any)?.messages ?? [];
      return messages.map((message: any) =>
        typeof message.content === "string" ? message.content : ""
      );
    })
    .join("\n");
}

beforeEach(() => {
  for (const fn of [
    invoke,
    invokeForUser,
    resolveProviderForUser,
    updateSkillJob,
    updatePersona,
    createSkillJob,
    runPythonTool,
    loadPrompt,
  ]) {
    fn.mockReset();
  }
  invokeForUser.mockImplementation(async (...a: unknown[]) => invoke(...a));
  invokeForUserWithReason.mockImplementation(async (...a: unknown[]) => ({
    text: await invoke(...a),
  }));
  resolveProviderForUser.mockResolvedValue({
    name: "test",
    capabilities: { streaming: true, vision: true, tools: true, jsonMode: true },
  });
  createSkillJob.mockResolvedValue(7);
  updateSkillJob.mockResolvedValue(undefined);
  updatePersona.mockResolvedValue(undefined);
  loadPrompt.mockReturnValue("prompt");
  runPythonTool.mockResolvedValue({ stdout: "", stderr: "" });
  invoke.mockResolvedValue(PERSONA_JSON);
});

describe("the videos in a distillation", () => {
  it("shows the vision stage the three frames and fences what was said", async () => {
    await runSkillPipeline({
      ...baseInput,
      videoFrames: FRAMES,
      videoTranscripts: ["我昨天去了海边。"],
      videoSkipped: 1,
    });

    expect(describedImageUrls()).toEqual(FRAMES);

    const prompts = allPromptText();
    expect(prompts).toContain("视频里说的话：");
    const at = prompts.indexOf("我昨天去了海边。");
    expect(at).toBeGreaterThanOrEqual(0);
    const open = prompts.lastIndexOf("MATERIAL>>>:", at);
    const close = prompts.indexOf("<<<END MATERIAL>>>", at);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(at);
    expect(prompts).toContain("还有 1 个视频没有读");
  }, 20_000);

  it("keeps the frames and says nothing about words when no engine could hear them", async () => {
    await runSkillPipeline({
      ...baseInput,
      videoFrames: FRAMES,
      videoTranscripts: [],
      videoSkipped: 0,
    });

    expect(describedImageUrls()).toEqual(FRAMES);
    expect(allPromptText()).not.toContain("视频里说的话");
  }, 20_000);
});
