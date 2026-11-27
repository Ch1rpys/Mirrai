import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The voices on offer, and where the read-aloud runs (B7.6).
 *
 * A voice name only means something to the online Edge service. A local
 * piper model has its own voice, so the list is empty there; and when
 * the operator has switched read-aloud off the endpoint says so rather
 * than letting the button fail.
 */

const engine = vi.hoisted(() => ({ value: "edge" as string }));
const leaves = vi.hoisted(() => ({ value: true }));

vi.mock("./_core/tts", () => ({
  ttsEngine: () => engine.value,
  ttsLeavesMachine: () => leaves.value,
  voicesForLocale: (locale: string) =>
    locale === "en"
      ? [{ id: "en-US-AriaNeural", label: "Aria" }]
      : [{ id: "zh-CN-XiaoxiaoNeural", label: "晓晓" }],
}));

import { appRouter } from "./routers";

function ctx(): TrpcContext {
  return {
    user: null,
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("chat.voices", () => {
  it("offers Edge voices, and says the words leave the machine", async () => {
    engine.value = "edge";
    leaves.value = true;
    const result = await appRouter.createCaller(ctx()).chat.voices({ locale: "zh" });
    expect(result.voices).toEqual([{ id: "zh-CN-XiaoxiaoNeural", label: "晓晓" }]);
    expect(result).toMatchObject({ enabled: true, engine: "edge", leavesMachine: true });
  });

  it("offers no names for a local engine, and says the words stay", async () => {
    engine.value = "piper";
    leaves.value = false;
    const result = await appRouter.createCaller(ctx()).chat.voices({ locale: "zh" });
    expect(result.voices).toEqual([]);
    expect(result).toMatchObject({ enabled: true, engine: "piper", leavesMachine: false });
  });

  it("says the read-aloud is off when the operator turned it off", async () => {
    engine.value = "off";
    leaves.value = false;
    const result = await appRouter.createCaller(ctx()).chat.voices({});
    expect(result).toMatchObject({ enabled: false, engine: "off" });
  });
});
