import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const readEmailConfig = vi.fn();
const saveEmailConfig = vi.fn();
const sendTestEmail = vi.fn();
const clearEmailConfig = vi.fn();

vi.mock("../_core/mail", () => ({
  readEmailConfig: (...args: unknown[]) => readEmailConfig(...args),
  saveEmailConfig: (...args: unknown[]) => saveEmailConfig(...args),
  sendTestEmail: (...args: unknown[]) => sendTestEmail(...args),
  clearEmailConfig: (...args: unknown[]) => clearEmailConfig(...args),
}));

import { appRouter } from "../routers";

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
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

const CONFIG = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  user: "me@example.test",
  pass: "the-password",
  from: "mirrai@example.test",
  to: "me@example.test",
  subjectWithName: false,
};

describe("the user's mail server (C5.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readEmailConfig.mockResolvedValue(null);
  });

  it("never returns the password", async () => {
    readEmailConfig.mockResolvedValue(CONFIG);
    const config = await appRouter.createCaller(ctxFor(1)).email.getConfig();
    expect(config).toMatchObject({ configured: true, host: CONFIG.host, port: 587 });
    expect(JSON.stringify(config)).not.toContain("the-password");
    expect((config as any).pass).toBeUndefined();
  });

  it("says when nothing is configured", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).email.getConfig(),
    ).resolves.toMatchObject({ configured: false, host: null });
  });

  it("saves the server for the caller", async () => {
    saveEmailConfig.mockResolvedValue(true);
    const input = {
      host: CONFIG.host,
      port: CONFIG.port,
      secure: false,
      user: CONFIG.user,
      pass: CONFIG.pass,
      from: CONFIG.from,
      to: CONFIG.to,
      subjectWithName: false,
    };
    await expect(
      appRouter.createCaller(ctxFor(3)).email.saveConfig(input),
    ).resolves.toEqual({ saved: true });
    expect(saveEmailConfig).toHaveBeenCalledWith(3, input);
  });

  it("refuses a save with no password and no saved one", async () => {
    saveEmailConfig.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(ctxFor(1)).email.saveConfig({
        host: "smtp.example.test",
        port: 587,
        secure: false,
        user: "u",
        from: "a@example.test",
        to: "b@example.test",
        subjectWithName: false,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("sends a test message and clears the server", async () => {
    sendTestEmail.mockResolvedValue(true);
    await expect(appRouter.createCaller(ctxFor(1)).email.test()).resolves.toEqual({ sent: true });
    expect(sendTestEmail).toHaveBeenCalledWith(1, "zh");
    await expect(appRouter.createCaller(ctxFor(1)).email.clear()).resolves.toEqual({ cleared: true });
    expect(clearEmailConfig).toHaveBeenCalledWith(1);
  });
});
