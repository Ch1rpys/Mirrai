import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The v5 mining layers only read `user` / `assistant`. Distillation used
 * to hand them `persona` and leftover speaker names, so a mapped log of
 * 小满 produced an empty act profile, no periods, and no open loops.
 */

const invoke = vi.fn();
const invokeForUser = vi.fn();
const invokeForUserWithReason = vi.fn();
const resolveProviderForUser = vi.fn();
const measureStyleProfile = vi.fn();
const updateSkillJob = vi.fn();
const updatePersona = vi.fn();
const createSkillJob = vi.fn();
const getFilesByPersonaId = vi.fn();
const getPersonaById = vi.fn();
const runPythonTool = vi.fn();
const loadPrompt = vi.fn();
const createChatSummary = vi.fn();
const claimMemoryExtraction = vi.fn();

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
  claimMemoryExtraction: (...a: unknown[]) => claimMemoryExtraction(...a),
  releaseMemoryExtraction: vi.fn(),
  iterateRecords: async function* () {},
  createDistillationChunk: vi.fn(),
  createDistillationCard: vi.fn(),
  createMemory: vi.fn(),
  getMemoriesByPersonaId: vi.fn().mockResolvedValue([]),
}));

vi.mock("./runner", () => ({
  runPythonTool: (...a: unknown[]) => runPythonTool(...a),
}));

vi.mock("./prompts", () => ({
  loadPrompt: (...a: unknown[]) => loadPrompt(...a),
}));

vi.mock("../_core/style-profile", () => ({
  measureStyleProfile: (...a: unknown[]) => measureStyleProfile(...a),
}));

import { runSkillPipeline } from "./pipeline";
import { renderFixture } from "../test-fixtures/render";
import {
  buildXiaomanRecords,
  formatShanghai,
  XIAOMAN_NAME,
  XIAOMAN_TRUTH,
} from "../test-fixtures/xiaoman";
import type { PersonaData } from "../_core/persona-schema";

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

function payloadText(req: unknown): string {
  if (typeof req === "string") return req;
  if (Array.isArray(req)) return req.map((item) => payloadText(item)).join("\n");
  if (req && typeof req === "object") {
    const record = req as { content?: unknown; messages?: unknown };
    return [payloadText(record.messages), payloadText(record.content)].join("\n");
  }
  return "";
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

function writtenPersona(): PersonaData {
  const call = updatePersona.mock.calls.find(
    (entry) => (entry[2] as { analysisStatus?: string })?.analysisStatus === "ready",
  );
  expect(call).toBeTruthy();
  return (call?.[2] as { personaData: PersonaData }).personaData;
}

function firstAfterSilenceIso(): string {
  const first = buildXiaomanRecords()
    .filter((row) => row.truth.period === "p2")
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
  if (!first) throw new Error("xiaoman has no second stretch");
  return first.timestamp.toISOString();
}

function expectMinedV5(data: PersonaData, boundaryIso?: string) {
  expect(data.actProfile).toBeTruthy();
  expect(data.actProfile!.samples).toBeGreaterThanOrEqual(40);

  const periods = data.periods ?? [];
  const iso = boundaryIso ?? firstAfterSilenceIso();
  expect(periods).toHaveLength(2);
  expect(periods[0]?.to).toBe(periods[1]?.from);
  expect(periods[1]?.from).toBe(iso);
  expect(formatShanghai(new Date(iso)).startsWith("2023-07-05")).toBe(true);
  expect(
    (periods[1]?.suppressionsDelta ?? []).some((row) => row.kind === "no_question_ending"),
  ).toBe(true);

  expect(data.openingProfile?.samples ?? 0).toBeGreaterThan(0);

  const them = (data.lifeEvents ?? []).find((event) =>
    event.title.includes(XIAOMAN_TRUTH.openLoopTa),
  );
  const me = (data.lifeEvents ?? []).find((event) =>
    event.title.includes(XIAOMAN_TRUTH.openLoopUser),
  );
  expect(them?.whoSaid).toBe("them");
  expect(me?.whoSaid).toBe("me");
}

const fixture = buildXiaomanRecords();
const chatContent = renderFixture(fixture, "generic-line");

const baseInput = {
  personaId: 1,
  userId: 1,
  characterFamily: "relationship" as const,
  name: XIAOMAN_NAME,
  chatContent,
  timeZone: "Asia/Shanghai",
};

beforeEach(() => {
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
    measureStyleProfile,
  ]) {
    fn.mockReset();
  }
  invoke.mockImplementation(async (req: unknown) => {
    const blob = JSON.stringify(req);
    if (blob.includes("anchor|milestone|anniversary|memory")) {
      return JSON.stringify({ facts: [], people: [], stances: [] });
    }
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
  getPersonaById.mockResolvedValue({ id: 1, userId: 1, name: XIAOMAN_NAME, personaData: {} });
  claimMemoryExtraction.mockResolvedValue(false);
  measureStyleProfile.mockResolvedValue({});
  loadPrompt.mockReturnValue("prompt");
  runPythonTool.mockResolvedValue({ stdout: "", stderr: "" });
});

describe("the v5 seam on a named transcript", () => {
  it("mines acts, periods, openings and open loops from generic-line text", async () => {
    await runSkillPipeline(baseInput);
    expectMinedV5(writtenPersona());
    expect(measureStyleProfile).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 1, userId: 1, force: true }),
    );
  }, 60_000);

  it("reads the records in the small-history analysis path too (B1.1)", async () => {
    // Below two hundred rows the pipeline still makes a single analyser
    // call instead of the chunked map stage. It used to read only
    // `chatContent`, which the upload entry point no longer fills with
    // the records — so a 120-row persona was analysed from nothing.
    const small = fixture.slice(0, 120);
    await runSkillPipeline({
      ...baseInput,
      chatContent: "",
      records: small.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        kind: row.kind,
      })),
    });
    const requests = invoke.mock.calls.map((call) => payloadText(call[0])).join("\n");
    const sample = small.find((row) => row.role === "assistant" && row.content.trim().length >= 4);
    expect(sample).toBeTruthy();
    expect(requests).toContain(sample!.content.trim());
    expect(requests).not.toContain("暂无聊天记录");
  }, 60_000);

  it("mines the same layers from structured records, with the fixture's own times", async () => {
    await runSkillPipeline({
      ...baseInput,
      records: fixture.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        kind: row.kind,
      })),
    });
    expectMinedV5(writtenPersona(), firstAfterSilenceIso());
  }, 60_000);
});
