import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

/**
 * The layered distillation: hashed blocks become observation cards,
 * the cards of a period become the analysis, and that analysis is
 * what the builder already knows how to read.
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
  createDistillationChunk: (...a: unknown[]) => createDistillationChunk(...a),
  createDistillationCard: (...a: unknown[]) => createDistillationCard(...a),
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
import { chunkRecords, type RecordLine } from "./chunks";
import { chunkHasFactCue } from "@shared/fact-cues";
import {
  buildXiaomanRecords,
  XIAOMAN_NAME,
} from "../test-fixtures/xiaoman";

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

const TIME_ZONE = "Asia/Shanghai";
const LINE_ID = /#\d+ /;

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

function isMapCall(req: unknown): boolean {
  return blobOf(req).includes("expression|trigger|conflict|care|memory|habit");
}

function isFactCall(req: unknown): boolean {
  return blobOf(req).includes("anchor|milestone|anniversary|memory");
}

function isMergeCall(req: unknown): boolean {
  return blobOf(req).includes("归并成四段");
}

function isHarmConfirm(req: unknown): boolean {
  const blob = blobOf(req);
  return blob.includes("伤害听的人") || blob.includes("hurting the person who heard");
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

function observationFrom(
  req: unknown,
  options: { quotes?: number[]; dimension?: string } = {},
): string {
  const user = messagesOf(req).find((message) => message.role === "user");
  const text = String(user?.content ?? "");
  const them = [...text.matchAll(/#(\d+)\s[^\n]*小满：/g)].map((match) => Number(match[1]));
  const me = [...text.matchAll(/#(\d+)\s[^\n]*我：/g)].map((match) => Number(match[1]));
  const quotes = options.quotes ?? (them.length > 0 ? [them[0]] : me.slice(0, 1));
  const dimension = options.dimension ?? "habit";
  if (quotes.length === 0) return JSON.stringify({ observations: [] });
  return JSON.stringify({
    observations: [{ dimension, claim: "会这样说", quotes }],
  });
}

function spokenRecords(count: number): PipelineRecord[] {
  const start = Date.parse("2023-01-01T12:00:00.000Z");
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    role: i % 2 === 0 ? "user" : "assistant",
    content: i % 2 === 0 ? `我在说第${i}句` : `在的呀 ${i}`,
    timestamp: new Date(start + i * 60_000),
    kind: "text" as const,
  }));
}

const fixture = buildXiaomanRecords();
const xiaomanRecords: PipelineRecord[] = fixture.map((row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  timestamp: row.timestamp,
  kind: row.kind,
}));
const xiaomanLines: RecordLine[] = fixture.map((row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  timestamp: row.timestamp,
  kind: row.kind,
  speaker: row.speaker,
}));
const xiaomanChunks = chunkRecords(xiaomanLines, {
  timeZone: TIME_ZONE,
  themName: XIAOMAN_NAME,
});

const baseInput = {
  personaId: 1,
  userId: 1,
  characterFamily: "relationship" as const,
  name: XIAOMAN_NAME,
  chatContent: "",
  timeZone: TIME_ZONE,
  records: xiaomanRecords,
};

let lastSkillPackage = "";

describe("the layered distillation", () => {
  const originalDelays = [...pipelineRetryPolicy.delaysMs];

  beforeEach(() => {
    pipelineRetryPolicy.delaysMs = [0, 0];
    lastSkillPackage = "";
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
      if (isHarmConfirm(req)) {
        const blob = payloadText(req);
        const indices = new Set<number>();
        for (const match of blob.matchAll(/"i":\s*(\d+)/g)) {
          indices.add(Number(match[1]));
        }
        const max = indices.size > 0 ? Math.max(...indices) : 0;
        return JSON.stringify(
          Array.from({ length: max + 1 }, (_, i) => ({ i, harm: true })),
        );
      }
      if (isFactCall(req)) return JSON.stringify({ facts: [], people: [], stances: [] });
      if (isMapCall(req)) return observationFrom(req);
      if (isMergeCall(req)) {
        return [
          "Expression DNA",
          "短句",
          "Emotional Triggers",
          "会在意",
          "Conflict Pattern",
          "先冷一下",
          "Memory Signature",
          "记得约定",
        ].join("\n");
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
    getPersonaById.mockResolvedValue({
      id: 1,
      userId: 1,
      name: XIAOMAN_NAME,
      personaData: {},
    });
    claimMemoryExtraction.mockResolvedValue(false);
    loadPrompt.mockReturnValue("prompt");
    createDistillationChunk.mockResolvedValue(undefined);
    createDistillationCard.mockResolvedValue(undefined);
    iterateRecords.mockImplementation(async function* () {});
    createMemory.mockResolvedValue(1);
    getMemoriesByPersonaId.mockResolvedValue([]);
    runPythonTool.mockImplementation(async (_script: string, args: string[]) => {
      const work = args[args.indexOf("--work") + 1];
      const persona = args[args.indexOf("--persona") + 1];
      lastSkillPackage = [
        work ? fs.readFileSync(work, "utf8") : "",
        persona ? fs.readFileSync(persona, "utf8") : "",
      ].join("\n");
      return { stdout: "", stderr: "" };
    });
  });

  afterEach(() => {
    pipelineRetryPolicy.delaysMs = [...originalDelays];
  });

  it("maps every block in deep mode", async () => {
    expect(xiaomanChunks.length).toBeGreaterThan(12);
    await runSkillPipeline({ ...baseInput, mode: "deep" });
    expect(invoke.mock.calls.filter((call) => isMapCall(call[0]))).toHaveLength(
      xiaomanChunks.length,
    );
  }, 90_000);

  it("maps twelve blocks in fast mode when the log is longer than that", async () => {
    await runSkillPipeline({ ...baseInput, mode: "fast" });
    expect(invoke.mock.calls.filter((call) => isMapCall(call[0]))).toHaveLength(12);
  }, 90_000);

  it("does not store a card that cites a line outside its block", async () => {
    invoke.mockImplementation(async (req: unknown) => {
      if (isMapCall(req)) return observationFrom(req, { quotes: [999_999] });
      if (isMergeCall(req)) return "ok";
      return actLabelsFrom(req) ?? PERSONA_JSON;
    });
    await runSkillPipeline({
      ...baseInput,
      records: spokenRecords(200),
      mode: "deep",
    });
    expect(createDistillationCard).not.toHaveBeenCalled();
    expect(
      createDistillationChunk.mock.calls.every((call) => call[0].cardCount === 0),
    ).toBe(true);
  }, 30_000);

  it("drops an expression card that only cites the user", async () => {
    invoke.mockImplementation(async (req: unknown) => {
      if (isMapCall(req)) {
        const user = messagesOf(req).find((message) => message.role === "user");
        const text = String(user?.content ?? "");
        const me = [...text.matchAll(/#(\d+)\s[^\n]*我：/g)].map((match) => Number(match[1]));
        return observationFrom(req, { quotes: me.slice(0, 1), dimension: "expression" });
      }
      if (isMergeCall(req)) return "ok";
      return actLabelsFrom(req) ?? PERSONA_JSON;
    });
    await runSkillPipeline({
      ...baseInput,
      records: spokenRecords(200),
      mode: "deep",
    });
    expect(createDistillationCard).not.toHaveBeenCalled();
  }, 30_000);

  it("merges cards rather than the original blocks, newest stretch first", async () => {
    await runSkillPipeline({ ...baseInput, mode: "deep" });

    const mergeCalls = invoke.mock.calls.filter((call) => isMergeCall(call[0]));
    expect(mergeCalls.length).toBeGreaterThan(0);
    for (const call of mergeCalls) {
      const user = messagesOf(call[0]).find((message) => message.role === "user");
      const text = String(user?.content ?? "");
      expect(text).not.toMatch(LINE_ID);
      expect(text).toContain("habit:");
      expect(text).toContain("MATERIAL>>>:");
    }

    const builderCall = invoke.mock.calls.find((call) =>
      blobOf(call[0]).includes("最近一段是这个人现在的样子"),
    );
    expect(builderCall).toBeTruthy();
    const builderUser = blobOf(builderCall![0]);
    const firstRange = builderUser.match(
      /\d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}(?:（现在）)?/,
    );
    expect(firstRange?.[0]).toContain("（现在）");
  }, 90_000);

  it("marks the persona as failed without retrying when too many blocks throw", async () => {
    invoke.mockImplementation(async (req: unknown) => {
      if (isMapCall(req)) throw new Error("down");
      return actLabelsFrom(req) ?? PERSONA_JSON;
    });
    const records = spokenRecords(200);
    const chunks = chunkRecords(records, { timeZone: TIME_ZONE, themName: XIAOMAN_NAME });
    await runSkillPipeline({
      ...baseInput,
      records,
      mode: "deep",
    });
    expect(invoke.mock.calls.filter((call) => isMapCall(call[0])).length).toBe(
      chunks.length * 2,
    );
    const errorWrite = updatePersona.mock.calls.find(
      (call) => (call[2] as { analysisStatus?: string })?.analysisStatus === "error",
    );
    expect(errorWrite).toBeTruthy();
    expect(String((errorWrite?.[2] as { analysisMessage?: string }).analysisMessage)).toMatch(
      /三成/,
    );
    expect(
      updatePersona.mock.calls.filter(
        (call) => (call[2] as { analysisStatus?: string })?.analysisStatus === "ready",
      ),
    ).toHaveLength(0);
  }, 30_000);

  it("does not put line-id citations in the exported skill package", async () => {
    await runSkillPipeline({ ...baseInput, mode: "deep" });
    expect(lastSkillPackage.length).toBeGreaterThan(0);
    expect(lastSkillPackage).not.toMatch(/#\d+/);
  }, 90_000);

  it("stores the birthday in the fixture as a record-sourced memory", async () => {
    const birthday = fixture.find((row) => row.content === "我生日是5月21号");
    expect(birthday).toBeTruthy();
    invoke.mockImplementation(async (req: unknown) => {
      if (isFactCall(req)) {
        const text = blobOf(req);
        if (birthday && text.includes(`#${birthday.id} `)) {
          return JSON.stringify({
            facts: [{
              title: "生日",
              description: "5月21号",
              category: "anchor",
              subject: "me",
              date: "05-21",
              quote: birthday.id,
            }],
            people: [],
            stances: [],
          });
        }
        return JSON.stringify({ facts: [], people: [], stances: [] });
      }
      if (isMapCall(req)) return observationFrom(req);
      if (isMergeCall(req)) return "ok";
      return actLabelsFrom(req) ?? PERSONA_JSON;
    });

    await runSkillPipeline({ ...baseInput, mode: "deep" });

    expect(createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "anchor",
        date: "05-21",
        recordId: birthday?.id,
        source: "records",
      }),
    );
  }, 90_000);

  it("does not send a block without a clue in fast mode", async () => {
    await runSkillPipeline({ ...baseInput, mode: "fast" });
    const factBlobs = invoke.mock.calls
      .filter((call) => isFactCall(call[0]))
      .map((call) => blobOf(call[0]));
    const uncued = xiaomanChunks.filter((chunk) => !chunkHasFactCue(chunk));
    expect(uncued.length).toBeGreaterThan(0);
    for (const chunk of uncued) {
      const first = chunk.rows[0];
      if (!first) continue;
      expect(factBlobs.some((blob) => blob.includes(`#${first.id} `))).toBe(false);
    }
  }, 90_000);

  it("drops a fact that cites a line from another block", async () => {
    invoke.mockImplementation(async (req: unknown) => {
      if (isFactCall(req)) {
        return JSON.stringify({
          facts: [{
            title: "生日",
            description: "5月21号",
            category: "anchor",
            subject: "me",
            date: "05-21",
            quote: 999_999,
          }],
          people: [],
          stances: [],
        });
      }
      if (isMapCall(req)) return observationFrom(req);
      if (isMergeCall(req)) return "ok";
      return actLabelsFrom(req) ?? PERSONA_JSON;
    });
    await runSkillPipeline({ ...baseInput, mode: "deep" });
    expect(createMemory).not.toHaveBeenCalled();
  }, 90_000);

  it("does not write the same memory twice", async () => {
    const store: Array<{ title: string; description: string; factKey: string }> = [];
    createMemory.mockImplementation(async (row: { title: string; description: string; factKey: string }) => {
      store.push(row);
      return store.length;
    });
    getMemoriesByPersonaId.mockImplementation(async () => store);
    invoke.mockImplementation(async (req: unknown) => {
      if (isFactCall(req)) {
        const birthday = fixture.find((row) => row.content === "我生日是5月21号");
        const text = blobOf(req);
        if (birthday && text.includes(`#${birthday.id} `)) {
          return JSON.stringify({
            facts: [{
              title: "生日",
              description: "5月21号",
              category: "anchor",
              subject: "me",
              date: "05-21",
              quote: birthday.id,
            }],
            people: [],
            stances: [],
          });
        }
        return JSON.stringify({ facts: [], people: [], stances: [] });
      }
      if (isMapCall(req)) return observationFrom(req);
      if (isMergeCall(req)) return "ok";
      return actLabelsFrom(req) ?? PERSONA_JSON;
    });

    await runSkillPipeline({ ...baseInput, mode: "deep" });
    const first = store.length;
    expect(first).toBeGreaterThan(0);
    await runSkillPipeline({ ...baseInput, mode: "deep" });
    expect(store.length).toBe(first);
  }, 90_000);
});
