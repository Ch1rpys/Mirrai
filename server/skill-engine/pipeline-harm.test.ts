import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Distillation writes a harm report after the map, from the records.
 */

const invoke = vi.fn();
const invokeForUser = vi.fn();
const invokeForUserWithReason = vi.fn();
const resolveProviderForUser = vi.fn();
const updateSkillJob = vi.fn();
const updatePersona = vi.fn();
const createSkillJob = vi.fn();
const getFilesByPersonaId = vi.fn();
const getPersonaById = vi.fn();
const runPythonTool = vi.fn();
const loadPrompt = vi.fn();
const createChatSummary = vi.fn();
const claimMemoryExtraction = vi.fn();
const createDistillationChunk = vi.fn();
const createDistillationCard = vi.fn();
const iterateRecords = vi.fn();
const createMemory = vi.fn();
const getMemoriesByPersonaId = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invoke(...a),
  },
  invokeForUser: (...a: unknown[]) => invokeForUser(...a),
  invokeForUserWithReason: (...a: unknown[]) => invokeForUserWithReason(...a),
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
  resolveProviderForPurpose: (...a: unknown[]) => resolveProviderForUser(...a),
  resolveProviderForPurposeWithOwnership: async (params: unknown) => ({
    provider: await resolveProviderForUser(params as any),
    owned: false,
  }),
}));

vi.mock("../db", () => ({
  getSkillJobById: vi.fn().mockResolvedValue(undefined),
  updateSkillJob: (...a: unknown[]) => updateSkillJob(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  createSkillJob: (...a: unknown[]) => createSkillJob(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  createChatSummary: (...a: unknown[]) => createChatSummary(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getRecordsVersion: vi.fn().mockResolvedValue("0:0"),
  getPersonaStyleProfile: vi.fn().mockResolvedValue(null),
  setPersonaStyleProfile: vi.fn().mockResolvedValue(true),
  getUserById: vi.fn().mockResolvedValue({ id: 1, name: "阿树", timezone: "Asia/Shanghai" }),
  getPersonaSettings: vi.fn().mockResolvedValue(undefined),
  setPersonaSettings: vi.fn().mockResolvedValue(undefined),
  listFidelityPairs: vi.fn().mockResolvedValue([]),
  claimMemoryExtraction: (...a: unknown[]) => claimMemoryExtraction(...a),
  releaseMemoryExtraction: vi.fn(),
  createDistillationChunk: (...a: unknown[]) => createDistillationChunk(...a),
  createDistillationCard: (...a: unknown[]) => createDistillationCard(...a),
  listDistillationCards: vi.fn().mockResolvedValue([]),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
  createMemory: (...a: unknown[]) => createMemory(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
}));

vi.mock("./runner", () => ({
  runPythonTool: (...a: unknown[]) => runPythonTool(...a),
}));

vi.mock("./prompts", () => ({
  loadPrompt: (...a: unknown[]) => loadPrompt(...a),
}));

import { pipelineRetryPolicy, runSkillPipeline, type PipelineRecord } from "./pipeline";

const PERSONA_JSON = JSON.stringify({
  personality: "短句",
  speakingStyle: "短句",
  catchphrases: ["嗯"],
  nickname: "满满",
  memories: "",
  attachmentStyle: "",
  loveLanguage: "",
  conflictStyle: "",
  touchingMoments: "",
  summary: "小满",
});

type ChatMessage = { role: string; content: unknown };

function messagesOf(req: unknown): ChatMessage[] {
  const messages = (req as { messages?: ChatMessage[] } | undefined)?.messages;
  return Array.isArray(messages) ? messages : [];
}

function blobOf(req: unknown): string {
  return messagesOf(req)
    .map((message) => String(message?.content ?? ""))
    .join("\n");
}

function payloadText(req: unknown): string {
  if (typeof req === "string") return req;
  if (Array.isArray(req)) return req.map((item) => payloadText(item)).join("\n");
  if (req && typeof req === "object") {
    const record = req as { content?: unknown; messages?: unknown };
    return [payloadText(record.messages), payloadText(record.content)].join("\n");
  }
  return "";
}

function isHarmConfirm(req: unknown): boolean {
  const blob = blobOf(req);
  return blob.includes("伤害听的人") || blob.includes("hurting the person who heard");
}

function actLabelsFrom(req: unknown): string | null {
  const blob = payloadText(req);
  if (!blob.includes('"prev"') || !/"i":/.test(blob)) return null;
  const indices = new Set<number>();
  for (const match of blob.matchAll(/"i":\s*(\d+)/g)) {
    indices.add(Number(match[1]));
  }
  if (indices.size === 0) return null;
  const max = Math.max(...indices);
  return JSON.stringify(
    Array.from({ length: max + 1 }, (_, i) => ({ i, act: "answer", prevAct: "other" })),
  );
}

function harmConfirmFrom(req: unknown): string {
  const blob = payloadText(req);
  const indices = new Set<number>();
  for (const match of blob.matchAll(/"i":\s*(\d+)/g)) {
    indices.add(Number(match[1]));
  }
  const max = indices.size > 0 ? Math.max(...indices) : 4;
  return JSON.stringify(
    Array.from({ length: max + 1 }, (_, i) => ({ i, harm: true })),
  );
}

// i18n:allow-identifier — the five designed belittling lines from the fixture.
const HARM_LINES = [
  "你真没用",
  "你怎么这么差",
  "你就是个废物",
  "你什么都做不好",
  "你这个人真失败",
];

const start = Date.parse("2023-01-01T12:00:00.000Z");
const records: PipelineRecord[] = HARM_LINES.flatMap((line, index) => [
  {
    id: index * 2 + 1,
    role: "user" as const,
    content: "嗯",
    timestamp: new Date(start + index * 60_000),
    kind: "text" as const,
  },
  {
    id: index * 2 + 2,
    role: "assistant" as const,
    content: line,
    timestamp: new Date(start + index * 60_000 + 1000),
    kind: "text" as const,
  },
]);

describe("the distillation writes a harm report", () => {
  const originalDelays = [...pipelineRetryPolicy.delaysMs];

  beforeEach(() => {
    pipelineRetryPolicy.delaysMs = [0, 0];
    for (const fn of [
      invoke,
      invokeForUser,
      invokeForUserWithReason,
      resolveProviderForUser,
      updateSkillJob,
      updatePersona,
      createSkillJob,
      getFilesByPersonaId,
      getPersonaById,
      runPythonTool,
      loadPrompt,
      createChatSummary,
      claimMemoryExtraction,
      createDistillationChunk,
      createDistillationCard,
      iterateRecords,
      createMemory,
      getMemoriesByPersonaId,
    ]) {
      fn.mockReset();
    }
    invoke.mockImplementation(async (req: unknown) => {
      if (isHarmConfirm(req)) return harmConfirmFrom(req);
      return actLabelsFrom(req) ?? PERSONA_JSON;
    });
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
    getFilesByPersonaId.mockResolvedValue([]);
    getPersonaById.mockResolvedValue({
      id: 1,
      userId: 1,
      name: "小满",
      personaData: {},
    });
    claimMemoryExtraction.mockResolvedValue(false);
    loadPrompt.mockReturnValue("prompt");
    createDistillationChunk.mockResolvedValue(undefined);
    createDistillationCard.mockResolvedValue(undefined);
    iterateRecords.mockImplementation(async function* () {});
    createMemory.mockResolvedValue(1);
    getMemoriesByPersonaId.mockResolvedValue([]);
    runPythonTool.mockResolvedValue({ stdout: "", stderr: "" });
  });

  afterEach(() => {
    pipelineRetryPolicy.delaysMs = [...originalDelays];
  });

  it("records five belittling lines as pending", async () => {
    await runSkillPipeline({
      personaId: 1,
      userId: 1,
      characterFamily: "relationship",
      name: "小满",
      chatContent: "",
      timeZone: "Asia/Shanghai",
      records,
      mode: "fast",
    });
    const written = updatePersona.mock.calls
      .map((call) => call[2] as { personaData?: { harmReport?: unknown } })
      .find((patch) => patch?.personaData);
    const report = (written?.personaData as { harmReport?: {
      categories: Array<{ kind: string; count: number }>;
      decision: string;
    } })?.harmReport;
    expect(report?.decision).toBe("pending");
    expect(report?.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "belittle", count: 5 }),
      ]),
    );
  }, 30_000);
});
