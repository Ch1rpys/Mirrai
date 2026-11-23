import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The binding rule (C9.1).
 *
 * Two kinds of assertion live here. The first is about the code itself:
 * six digits, one use, three wrong tries. The second is structural, and it
 * is the one that matters most for a public bot: **every** adapter's
 * inbound path asks whether the conversation is bound before it does
 * anything else.
 */

const getChannelState = vi.fn();
const upsertChannelState = vi.fn();
const getChannelBinding = vi.fn();
const getChannelDefaultPersona = vi.fn();
const setChannelBindingPersona = vi.fn();
const getPersonaById = vi.fn();

vi.mock("../db", () => ({
  getChannelState: (...a: unknown[]) => getChannelState(...a),
  upsertChannelState: (...a: unknown[]) => upsertChannelState(...a),
  getChannelBinding: (...a: unknown[]) => getChannelBinding(...a),
  getChannelDefaultPersona: (...a: unknown[]) => getChannelDefaultPersona(...a),
  setChannelBindingPersona: (...a: unknown[]) => setChannelBindingPersona(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

import {
  MAX_BIND_ATTEMPTS,
  clearBindCode,
  ensureBindCode,
  handleBindAttempt,
  isBindCommand,
  newBindCode,
  readChannelCursor,
  requireBoundChannel,
} from "./binding";

let cursor: string | null;

beforeEach(() => {
  vi.clearAllMocks();
  cursor = null;
  getChannelState.mockImplementation(async () => (cursor ? { cursor } : { cursor: null }));
  upsertChannelState.mockImplementation(async (_u: number, _c: string, data: { cursor?: string | null }) => {
    if ("cursor" in data) cursor = data.cursor ?? null;
    return 1;
  });
  getChannelDefaultPersona.mockResolvedValue({ personaId: 7 });
  setChannelBindingPersona.mockResolvedValue(1);
  getPersonaById.mockResolvedValue({ id: 7, name: "小满" });
});

describe("the code", () => {
  it("is six digits, leading zeros included", () => {
    expect(newBindCode(() => 7)).toBe("000007");
    expect(newBindCode(() => 999_999)).toBe("999999");
    expect(newBindCode(() => 1_000_007)).toBe("000007");
    expect(newBindCode(() => 123_456)).toBe("123456");
  });

  it("is made once and kept", async () => {
    const first = await ensureBindCode(1, "telegram", () => 42);
    const second = await ensureBindCode(1, "telegram", () => 99);
    expect(first).toBe("000042");
    expect(second).toBe("000042");
  });

  it("recognises a bind command but not ordinary text", () => {
    expect(isBindCommand("/bind 123456")).toBe(true);
    expect(isBindCommand("/BIND 123456")).toBe(true);
    expect(isBindCommand("/bind")).toBe(true);
    expect(isBindCommand("/binder 1")).toBe(false);
    expect(isBindCommand("在吗")).toBe(false);
  });

  it("survives a cursor that is not JSON", async () => {
    cursor = "not json";
    expect(await readChannelCursor(1, "telegram")).toEqual({});
  });

  it("is cleared without losing the protocol cursor", async () => {
    cursor = JSON.stringify({ cursor: "900", bindCode: "123456", bindAttempts: 1 });
    await clearBindCode(1, "telegram");
    const stored = JSON.parse(cursor!);
    expect(stored.bindCode).toBeUndefined();
    expect(stored.bindAttempts).toBeUndefined();
    expect(stored.cursor).toBe("900");
  });
});

describe("a bind attempt", () => {
  it("ignores anything that is not a bind command", async () => {
    cursor = JSON.stringify({ bindCode: "123456" });
    const outcome = await handleBindAttempt({
      userId: 1,
      channel: "telegram",
      conversationKey: "42",
      text: "在吗",
      locale: "zh",
    });
    expect(outcome).toEqual({ handled: false });
    expect(setChannelBindingPersona).not.toHaveBeenCalled();
  });

  it("counts a wrong code and says how many tries are left", async () => {
    cursor = JSON.stringify({ bindCode: "123456", bindAttempts: 0 });
    const outcome = await handleBindAttempt({
      userId: 1,
      channel: "telegram",
      conversationKey: "42",
      text: "/bind 000000",
      locale: "zh",
    });
    expect(outcome).toMatchObject({ handled: true, bound: false, reason: "wrong_code" });
    expect(outcome.handled && outcome.reply).toContain(String(MAX_BIND_ATTEMPTS - 1));
  });

  it("uses the code up on the third wrong try", async () => {
    cursor = JSON.stringify({ bindCode: "123456", bindAttempts: 0 });
    for (let attempt = 0; attempt < MAX_BIND_ATTEMPTS; attempt += 1) {
      await handleBindAttempt({
        userId: 1,
        channel: "telegram",
        conversationKey: "42",
        text: "/bind 000000",
        locale: "zh",
      });
    }
    expect(JSON.parse(cursor!).bindCode).toBeUndefined();
    const after = await handleBindAttempt({
      userId: 1,
      channel: "telegram",
      conversationKey: "42",
      text: "/bind 123456",
      locale: "zh",
    });
    expect(after).toMatchObject({ handled: true, bound: false, reason: "no_code" });
    expect(setChannelBindingPersona).not.toHaveBeenCalled();
  });

  it("binds and uses the code up", async () => {
    cursor = JSON.stringify({ bindCode: "123456", bindAttempts: 2 });
    const outcome = await handleBindAttempt({
      userId: 1,
      channel: "telegram",
      conversationKey: "42",
      conversationName: "阿树",
      text: "/bind 123456",
      locale: "zh",
    });
    expect(outcome).toMatchObject({ handled: true, bound: true });
    expect(setChannelBindingPersona).toHaveBeenCalledWith({
      userId: 1,
      channel: "telegram",
      targetId: "42",
      personaId: 7,
      targetName: "阿树",
    });
    expect(JSON.parse(cursor!).bindCode).toBeUndefined();
  });

  it("waits for a persona instead of binding to nothing", async () => {
    getChannelDefaultPersona.mockResolvedValue(undefined);
    cursor = JSON.stringify({ bindCode: "123456", bindAttempts: 0 });
    const outcome = await handleBindAttempt({
      userId: 1,
      channel: "telegram",
      conversationKey: "42",
      text: "/bind 123456",
      locale: "zh",
    });
    expect(outcome).toMatchObject({ handled: true, bound: false, reason: "no_persona" });
    expect(setChannelBindingPersona).not.toHaveBeenCalled();
  });
});

describe("the gate", () => {
  it("returns the persona of an active binding", async () => {
    getChannelBinding.mockResolvedValue({ id: 3, personaId: 7, isActive: true });
    await expect(requireBoundChannel({
      userId: 1,
      channel: "discord",
      conversationKey: "222",
    })).resolves.toEqual({ bindingId: 3, personaId: 7 });
  });

  it("returns null for no binding, or an inactive one", async () => {
    getChannelBinding.mockResolvedValue(undefined);
    expect(await requireBoundChannel({ userId: 1, channel: "discord", conversationKey: "222" })).toBeNull();
    getChannelBinding.mockResolvedValue({ id: 3, personaId: 7, isActive: false });
    expect(await requireBoundChannel({ userId: 1, channel: "discord", conversationKey: "222" })).toBeNull();
  });
});

describe("every bot adapter gates its inbound path", () => {
  const ROOT = resolve(import.meta.dirname, "../..");
  const ADAPTERS = ["telegram", "discord", "matrix"];

  it("asks the gate before it answers anything", () => {
    for (const channel of ADAPTERS) {
      const source = readFileSync(resolve(ROOT, `server/channels/${channel}.ts`), "utf-8");
      expect(source, `${channel} imports the gate`).toContain("requireBoundChannel");
      const gateAt = source.indexOf("await requireBoundChannel(");
      const firstChatAt = source.indexOf("handleChannelChat(");
      expect(gateAt, `${channel} calls the gate`).toBeGreaterThan(-1);
      expect(firstChatAt, `${channel} calls the pipeline`).toBeGreaterThan(-1);
      expect(gateAt, `${channel} gates before the pipeline`).toBeLessThan(firstChatAt);
      // And the bind attempt is what an unbound conversation may still say.
      expect(source).toContain("handleBindAttempt");
    }
  });

  it("does not answer in a group or a non-direct room", () => {
    const telegram = readFileSync(resolve(ROOT, "server/channels/telegram.ts"), "utf-8");
    expect(telegram).toContain('seen.chatType !== "private"');
    const discord = readFileSync(resolve(ROOT, "server/channels/discord.ts"), "utf-8");
    expect(discord).toContain("if (event.guild_id) return null;");
    const matrix = readFileSync(resolve(ROOT, "server/channels/matrix.ts"), "utf-8");
    expect(matrix).toContain("m.direct");
  });
});
