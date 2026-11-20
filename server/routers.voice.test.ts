import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * A voice message through the router.
 *
 * The persona below runs against a provider that cannot transcribe —
 * the case a local whisper.cpp engine exists for. The router has to
 * hear the recording through the engine and answer it, and when the
 * engine hears nothing it has to say so instead of inventing words.
 */

const execFileMock = vi.fn();
const storagePut = vi.fn();
const getPersonaById = vi.fn();
const resolveProviderForUser = vi.fn();
const runConversation = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("./_core/ffmpeg", () => ({
  hasFfmpeg: async () => true,
  toWav16k: async (input: string) => input,
}));

vi.mock("./storage", () => ({
  storagePut: (...a: unknown[]) => storagePut(...a),
  storageDelete: vi.fn(),
  storageDeleteTree: vi.fn(),
}));

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("./llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
  resolveProviderForUserWithOwnership: vi.fn(),
  resolveProviderForPurposeWithOwnership: vi.fn(),
  invalidateUserProviderCache: vi.fn(),
}));

vi.mock("./chat/service", () => ({
  runConversation: (...a: unknown[]) => runConversation(...a),
  withPersonaTurn: async (_key: string, work: () => Promise<unknown>) => work(),
  ChatClosedError: class ChatClosedError extends Error {},
  PersonaAsleepError: class PersonaAsleepError extends Error {},
  clampContextLimit: (value: unknown) => value,
  clampTemperature: (value: unknown) => value,
  clampMaxTokens: (value: unknown) => value,
  sanitizeExtraConfig: (value: unknown) => value,
}));

import { appRouter } from "./routers";

type Callback = (error: unknown, stdout?: string, stderr?: string) => void;

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: `User ${userId}`,
      timezone: null,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
  } as unknown as TrpcContext;
}

const persona = {
  id: 5,
  userId: 1,
  name: "小A",
  analysisStatus: "ready",
  emotionalState: "warm",
  llmProvider: "ollama",
  personaData: {},
} as any;

async function* emptyTurn() {
  yield {
    type: "done",
    graduationSuggested: false,
    careNote: null,
    crisis: false,
  };
}

function voiceRequest() {
  return {
    personaId: 5,
    audioContent: Buffer.from("pretend voice").toString("base64"),
    duration: 3,
    fileName: "voice.webm",
    locale: "zh" as const,
  };
}

describe("a voice message through the router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STT_ENGINE", "whisper-cpp");
    vi.stubEnv("WHISPER_CPP_BIN", "/opt/whisper/whisper-cli");
    vi.stubEnv("WHISPER_CPP_MODEL", "/models/ggml-base.bin");
    getPersonaById.mockResolvedValue(persona);
    storagePut.mockResolvedValue({ url: "/uploads/chat/1/5/voice.webm" });
    // A provider with no speech-to-text service at all, the way Ollama is.
    resolveProviderForUser.mockResolvedValue({ name: "ollama", isConfigured: () => true });
    runConversation.mockImplementation(() => emptyTurn());
    execFileMock.mockImplementation((_bin: string, _args: string[], _options: unknown, callback: Callback) => {
      callback(null, "在吗\n", "");
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hears the recording with the local engine even when the provider cannot", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).chat.sendVoice(voiceRequest());

    expect(result.transcription).toBe("在吗");
    expect(result.transcriptionFailed).toBeUndefined();
    expect(runConversation).toHaveBeenCalledTimes(1);
    const options = runConversation.mock.calls[0]![0] as {
      message: string;
      media: { type: string; url: string };
    };
    expect(options.message).toBe("在吗");
    expect(options.media).toEqual({ type: "voice", url: "/uploads/chat/1/5/voice.webm" });
  });

  it("still says it could not hear rather than making words up", async () => {
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _options: unknown, callback: Callback) => {
        callback(Object.assign(new Error("Could not read the file"), { code: 1 }), "", "");
      },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await appRouter.createCaller(ctxFor(1)).chat.sendVoice(voiceRequest());

    expect(result.transcriptionFailed).toBe(true);
    expect(result.transcription).toBe("");
    expect(result.reply).toBe("");
    expect(runConversation).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
