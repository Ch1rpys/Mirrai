import { describe, expect, it, vi } from "vitest";

vi.mock("./ffmpeg", () => ({ hasFfmpeg: async () => true }));
vi.mock("./stt", () => ({ sttIsLocal: () => true, sttEngine: () => "whisper-cpp" }));
vi.mock("./tts", () => ({ ttsEngine: () => "piper" }));
vi.mock("../llm", () => ({
  registry: {
    getDefaultName: () => "OpenAI",
    list: () => [
      { name: "OpenAI", configured: true },
      { name: "Local", configured: true },
      { name: "Unconfigured", configured: false },
    ],
    get: (name: string) => ({
      capabilities: { vision: name === "OpenAI" },
    }),
  },
}));

import { systemRouter } from "./systemRouter";

describe("what this machine can do", () => {
  it("says which optional tools are here and which providers can see", async () => {
    const capabilities = await systemRouter.createCaller({} as never).capabilities();
    expect(capabilities).toMatchObject({
      streaming: true,
      defaultProvider: "OpenAI",
      providers: ["OpenAI", "Local"],
      ffmpeg: true,
      sttLocal: true,
      sttEngine: "whisper-cpp",
      ttsEngine: "piper",
      visionProviders: ["OpenAI"],
    });
  });
});
