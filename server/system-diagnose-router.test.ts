/**
 * `system.diagnose` — the route around the one-click diagnosis (C8.12).
 *
 * The checks themselves are tested in `server/system-diagnose.test.ts`. This
 * is the part that belongs to the router: a signed-in user is required, the
 * user id and language are what reaches the logic, and pressing the button
 * twice inside a minute is refused.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const runDiagnose = vi.fn();
const createDiagnoseDeps = vi.fn();

vi.mock("./system/diagnose", () => ({
  runDiagnose: (...args: unknown[]) => runDiagnose(...args),
}));
vi.mock("./system/diagnose-deps", () => ({
  createDiagnoseDeps: (...args: unknown[]) => createDiagnoseDeps(...args),
}));

import { RATE_LIMITS, rateLimiter } from "./_core/rate-limit";
import { systemRouter } from "./_core/systemRouter";

function ctxFor(userId: number, name = "Somebody"): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      name,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastSignedIn: new Date(0),
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: {
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "user-agent": "TestBrowser" },
    } as never,
    res: {} as never,
    locale: "zh",
  } as unknown as TrpcContext;
}

describe("system.diagnose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimiter.reset?.();
    runDiagnose.mockResolvedValue({
      items: [{ id: "database", status: "ok", detail: "fine" }],
    });
    createDiagnoseDeps.mockReturnValue({});
  });

  it("needs a signed-in user", async () => {
    const anonymous = { ...ctxFor(1), user: null } as unknown as TrpcContext;
    await expect(systemRouter.createCaller(anonymous).diagnose()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(runDiagnose).not.toHaveBeenCalled();
  });

  it("runs the checks for the user, in their language", async () => {
    const caller = systemRouter.createCaller(ctxFor(7));
    const result = await caller.diagnose();

    expect(createDiagnoseDeps).toHaveBeenCalledWith(7);
    expect(runDiagnose).toHaveBeenCalledWith({
      locale: "zh",
      deps: {},
    });
    expect(result).toEqual({
      items: [{ id: "database", status: "ok", detail: "fine" }],
    });
  });

  it("answers in English when the interface asked for English", async () => {
    const english = { ...ctxFor(7), locale: "en" } as TrpcContext;
    await systemRouter.createCaller(english).diagnose();
    expect(runDiagnose).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en" }),
    );
  });

  it("does not hand the checks anything about the person", async () => {
    await systemRouter.createCaller(ctxFor(7, "sentinel-username")).diagnose();
    const passed = runDiagnose.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(passed).sort()).toEqual(["deps", "locale"]);
    expect(JSON.stringify(passed)).not.toContain("sentinel-username");
  });

  it("refuses the second press within a minute", async () => {
    const caller = systemRouter.createCaller(ctxFor(7));
    await caller.diagnose();
    await expect(caller.diagnose()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(runDiagnose).toHaveBeenCalledTimes(1);
  });

  it("counts each user against their own bucket", async () => {
    const first = systemRouter.createCaller(ctxFor(7));
    const second = systemRouter.createCaller(ctxFor(8));
    await first.diagnose();
    await second.diagnose();
    expect(runDiagnose).toHaveBeenCalledTimes(2);
    await expect(first.diagnose()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await expect(second.diagnose()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("is limited to once a minute per user", () => {
    expect(RATE_LIMITS.diagnose).toMatchObject({
      name: "diagnose",
      limit: 1,
      windowMs: 60_000,
      scope: "user",
    });
  });
});
