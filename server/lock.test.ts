import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { copy } from "@shared/copy";
import { hashPassword } from "./_core/password";
import { formatErrorForClient } from "./_core/trpc";
import { rateLimiter } from "./_core/rate-limit";
import {
  hasRecentUnlock,
  isRequestLocked,
  noteUnlock,
  resetAppLockStore,
  sessionKeyFromCookieHeader,
} from "./_core/app-lock";
import { TRPCError } from "@trpc/server";

/**
 * The app lock, enforced by the server (C8.4).
 *
 * Three promises are tested here:
 *
 * - a session that has not entered the PIN cannot read a persona, a
 *   message or a file, and `/uploads`, the chat stream and the phone
 *   socket refuse it the same way;
 * - the idle window slides on every request that gets through, so
 *   "idle" means what it says;
 * - a locked persona asks again within five minutes even when the app
 *   itself is open, and the lobby does not show its name.
 *
 * The PIN itself never appears in the database: the route hands
 * `setUserLock` a scrypt hash, and the database test in
 * `server/lock-db.test.ts` reads the column back.
 */

const getPersonasWithStats = vi.fn();
const getPersonaById = vi.fn();
const getPersonaStateSettings = vi.fn();
const getUserById = vi.fn();
const getUserLockRow = vi.fn();
const setUserLock = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonasWithStats: (...a: unknown[]) => getPersonasWithStats(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getPersonaStateSettings: (...a: unknown[]) => getPersonaStateSettings(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getUserLockRow: (...a: unknown[]) => getUserLockRow(...a),
  setUserLock: (...a: unknown[]) => setUserLock(...a),
}));

const generateRegistrationOptions = vi.fn();
const verifyRegistrationResponse = vi.fn();
const generateAuthenticationOptions = vi.fn();
const verifyAuthenticationResponse = vi.fn();

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (...a: unknown[]) => generateRegistrationOptions(...a),
  verifyRegistrationResponse: (...a: unknown[]) => verifyRegistrationResponse(...a),
  generateAuthenticationOptions: (...a: unknown[]) => generateAuthenticationOptions(...a),
  verifyAuthenticationResponse: (...a: unknown[]) => verifyAuthenticationResponse(...a),
}));

import { appRouter } from "./routers";

const NOW = new Date("2026-11-21T10:00:00.000Z");

let pinHash: string;
let passwordHash: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetAppLockStore();
  await rateLimiter.reset();
  pinHash = await hashPassword("4821");
  passwordHash = await hashPassword("correct horse");
  getPersonasWithStats.mockResolvedValue([
    { id: 5, name: "小满", avatarUrl: "/uploads/a.png", settings: {} },
    { id: 6, name: "小林", avatarUrl: null, settings: {} },
  ]);
  getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", settings: {} });
  getPersonaStateSettings.mockResolvedValue({});
  getUserById.mockResolvedValue({ id: 1, username: "阿树", passwordHash });
  getUserLockRow.mockResolvedValue({ lockPinHash: pinHash, lockSettings: { enabled: true } });
  setUserLock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The signed-in user, with the lock switched on by default. */
function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: "阿树",
    passwordHash,
    lockPinHash: pinHash,
    lockSettings: { enabled: true, idleMinutes: 5, passkeys: [] },
    timezone: "Asia/Shanghai",
    locale: "zh",
    role: "user",
    ...overrides,
  };
}

function ctxFor(
  overrides: Record<string, unknown> = {},
  cookie = "app_session_id=session-a",
): TrpcContext {
  return {
    user: user(overrides),
    locale: "zh",
    req: {
      headers: { cookie },
      socket: { remoteAddress: "127.0.0.1" },
      get: (name: string) => (name === "host" ? "localhost:3000" : undefined),
      protocol: "http",
    },
    res: { cookie: () => {}, clearCookie: () => {} },
  } as unknown as TrpcContext;
}

describe("the app lock at the tRPC edge", () => {
  it("refuses every persona read until the PIN is entered", async () => {
    const caller = appRouter.createCaller(ctxFor());
    const denied = await caller.persona.list().catch((error) => error);
    expect(denied.code).toBe("FORBIDDEN");
    expect(denied.mirraiCode).toBe("LOCKED");

    await caller.lock.verifyPin({ pin: "4821" });
    const rows = await caller.persona.list();
    expect(rows.map((row: { id: number }) => row.id)).toEqual([5, 6]);
  });

  it("names the lock in data.code so the interface can open the lock screen", () => {
    const locked = Object.assign(
      new TRPCError({ code: "FORBIDDEN", message: "locked" }),
      { mirraiCode: "LOCKED" },
    );
    const formatted = formatErrorForClient({
      shape: { message: "locked", code: -32003, data: {} },
      error: locked,
      ctx: { locale: "zh" },
    });
    expect(formatted.data.code).toBe("LOCKED");
    expect(formatted.message).toBe("locked");
  });

  it("locks again after the idle window, and every request slides it", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await caller.lock.verifyPin({ pin: "4821" });

    vi.setSystemTime(new Date(NOW.getTime() + 4 * 60_000));
    await expect(caller.persona.list()).resolves.toBeTruthy();
    // The 4-minute read slid the window to 9 minutes; 4 more is still open.
    vi.setSystemTime(new Date(NOW.getTime() + 8 * 60_000));
    await expect(caller.persona.list()).resolves.toBeTruthy();
    // Now 6 minutes of complete silence: 14 > 8 + 5.
    vi.setSystemTime(new Date(NOW.getTime() + 14 * 60_000));
    await expect(caller.persona.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets the account password open a forgotten PIN", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      caller.lock.verifyPassword({ password: "wrong" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.lock.verifyPassword({ password: "correct horse" });
    await expect(caller.persona.list()).resolves.toBeTruthy();
  });

  it("locks the session again on demand", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await caller.lock.verifyPin({ pin: "4821" });
    await caller.lock.lockNow();
    await expect(caller.persona.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("gives one session an unlock and not the other", async () => {
    const first = appRouter.createCaller(ctxFor({}, "app_session_id=session-a"));
    const second = appRouter.createCaller(ctxFor({}, "app_session_id=session-b"));
    await first.lock.verifyPin({ pin: "4821" });
    await expect(first.persona.list()).resolves.toBeTruthy();
    await expect(second.persona.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("a wrong PIN", () => {
  it("stops the PIN after five tries and says to use the password", async () => {
    const caller = appRouter.createCaller(ctxFor());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        caller.lock.verifyPin({ pin: "0000" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const sixth = await caller.lock.verifyPin({ pin: "0000" }).catch((error) => error);
    expect(sixth.code).toBe("FORBIDDEN");
    expect(sixth.message).toBe(copy("zh", "errors.lockTooManyAttempts"));
    // The password is still the way out.
    await caller.lock.verifyPassword({ password: "correct horse" });
    await expect(caller.persona.list()).resolves.toBeTruthy();
  });
});

describe("setting the lock up", () => {
  it("stores a hash of the PIN, never the PIN", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await caller.lock.setPin({ pin: "4821", currentPassword: "correct horse" });
    const [, patch] = setUserLock.mock.calls.at(-1) as [number, Record<string, unknown>];
    expect(typeof patch.lockPinHash).toBe("string");
    expect(patch.lockPinHash).not.toBe("4821");
    expect(String(patch.lockPinHash).startsWith("scrypt$")).toBe(true);
    expect(patch.lockSettings).toMatchObject({ enabled: true });
  });

  it("refuses a PIN that is not 4 to 8 digits", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      caller.lock.setPin({ pin: "12", currentPassword: "correct horse" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.lock.setPin({ pin: "12ab", currentPassword: "correct horse" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("asks for the account password, not just the PIN", async () => {
    const caller = appRouter.createCaller(ctxFor());
    const denied = await caller
      .lock.setPin({ pin: "4821", currentPassword: "guess" })
      .catch((error) => error);
    expect(denied.code).toBe("BAD_REQUEST");
    expect(denied.message).toBe(copy("zh", "errors.lockPasswordWrong"));
  });

  it("turning the lock off removes the PIN and the passkeys", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await caller.lock.disable({ currentPassword: "correct horse" });
    const [, patch] = setUserLock.mock.calls.at(-1) as [number, Record<string, unknown>];
    expect(patch.lockPinHash).toBeNull();
    expect(patch.lockSettings).toMatchObject({ enabled: false, passkeys: [] });
  });
});

describe("a locked persona", () => {
  it("asks for the PIN within five minutes even when the app is open", async () => {
    getPersonaStateSettings.mockImplementation(async (personaId: number) =>
      personaId === 5 ? { locked: true } : {},
    );
    const caller = appRouter.createCaller(ctxFor({
      lockSettings: { enabled: false, idleMinutes: 5, passkeys: [] },
    }));

    await expect(caller.persona.get({ id: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Another persona is not affected.
    await expect(caller.persona.get({ id: 6 })).resolves.toBeTruthy();

    await caller.lock.verifyPin({ pin: "4821" });
    await expect(caller.persona.get({ id: 5 })).resolves.toBeTruthy();

    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000));
    await expect(caller.persona.get({ id: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not show its name or face in the lobby until unlocked", async () => {
    getPersonasWithStats.mockResolvedValue([
      { id: 5, name: "小满", avatarUrl: "/uploads/a.png", settings: { locked: true } },
      { id: 6, name: "小林", avatarUrl: null, settings: {} },
    ]);
    const caller = appRouter.createCaller(ctxFor({
      lockSettings: { enabled: false, idleMinutes: 5, passkeys: [] },
    }));

    const hidden = await caller.persona.list();
    expect(hidden[0]).toMatchObject({ id: 5, name: "", avatarUrl: null, locked: true });
    expect(hidden[1]).toMatchObject({ id: 6, name: "小林" });

    await caller.lock.verifyPin({ pin: "4821" });
    const shown = await caller.persona.list();
    expect(shown[0]).toMatchObject({ id: 5, name: "小满" });
    expect((shown[0] as { locked?: boolean }).locked).toBeUndefined();
  });
});

describe("passkeys", () => {
  const credential = {
    id: "cred-1",
    publicKey: new Uint8Array([1, 2, 3]),
    counter: 0,
    transports: ["internal"],
  };

  beforeEach(() => {
    generateRegistrationOptions.mockResolvedValue({
      challenge: "register-challenge",
      rp: { id: "localhost", name: "Mirrai" },
    });
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: { credential },
    });
    generateAuthenticationOptions.mockResolvedValue({ challenge: "auth-challenge" });
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 3 },
    });
  });

  it("registers one while the app is open and unlocks with it", async () => {
    const open = appRouter.createCaller(ctxFor({
      lockSettings: { enabled: false, idleMinutes: 5, passkeys: [] },
    }));
    await open.lock.passkey.registerOptions();
    const registered = await open.lock.passkey.registerVerify({ response: {} });
    expect(registered.id).toBe("cred-1");
    const [, patch] = setUserLock.mock.calls.at(-1) as [number, Record<string, unknown>];
    const saved = (patch.lockSettings as { passkeys: Array<Record<string, unknown>> }).passkeys[0];
    expect(saved.id).toBe("cred-1");
    expect(saved.publicKey).toBe(Buffer.from([1, 2, 3]).toString("base64url"));

    const locked = appRouter.createCaller(ctxFor({
      lockSettings: {
        enabled: true,
        idleMinutes: 5,
        passkeys: [{ id: "cred-1", publicKey: Buffer.from([1, 2, 3]).toString("base64url"), counter: 0 }],
      },
    }));
    await expect(locked.persona.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await locked.lock.passkey.authOptions();
    await locked.lock.passkey.authVerify({ response: { id: "cred-1" } });
    await expect(locked.persona.list()).resolves.toBeTruthy();
    const [, updated] = setUserLock.mock.calls.at(-1) as [number, Record<string, unknown>];
    const after = (updated.lockSettings as { passkeys: Array<Record<string, unknown>> }).passkeys[0];
    expect(after.counter).toBe(3);
  });

  it("refuses registration from a session that has not unlocked", async () => {
    const locked = appRouter.createCaller(ctxFor());
    await expect(locked.lock.passkey.registerOptions()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a counter that only goes backwards", async () => {
    verifyAuthenticationResponse.mockRejectedValue(new Error("counter went backwards"));
    const locked = appRouter.createCaller(ctxFor({
      lockSettings: {
        enabled: true,
        idleMinutes: 5,
        passkeys: [{ id: "cred-1", publicKey: "AQID", counter: 9 }],
      },
    }));
    await locked.lock.passkey.authOptions();
    const denied = await locked
      .lock.passkey.authVerify({ response: { id: "cred-1" } })
      .catch((error) => error);
    expect(denied.code).toBe("BAD_REQUEST");
    expect(denied.message).toBe(copy("zh", "errors.lockPasskeyFailed"));
  });
});

describe("the routes that are not tRPC", () => {
  it("reports a locked session to the uploads guard, the stream and the socket", async () => {
    const lockedUser = user();
    const request = { headers: { cookie: "app_session_id=session-c" } };
    expect(await isRequestLocked(request as never, lockedUser)).toBe(true);

    const key = sessionKeyFromCookieHeader("app_session_id=session-c");
    expect(key).toBeTruthy();
    await noteUnlock({ enabled: true, idleMinutes: 5, passkeys: [] }, key);
    expect(await hasRecentUnlock(key)).toBe(true);
    expect(await isRequestLocked(request as never, lockedUser)).toBe(false);
  });

  it("keeps the lock checks on the non-tRPC route sources", async () => {
    const { readFileSync } = await import("node:fs");
    const files = [
      "server/_core/uploads.ts",
      "server/chat/stream-route.ts",
      "server/chat/call.ts",
      "server/importers/upload-route.ts",
      "server/backup/route.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      expect(source, file).toMatch(/isRequestLocked|deps\.locked|personaLocked/);
    }
  });
});

describe("the structure the guard relies on", () => {
  it("puts the lock guard on every protected procedure", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("server/_core/trpc.ts", "utf-8");
    expect(source).toMatch(/export const protectedProcedure = t\.procedure\s*\.use\(requireUser\)\s*\.use\(appLockGuard\)\s*\.use\(sealedGuard\)/);
    expect(source).toMatch(/APP_LOCK_EXEMPT_PREFIXES = \["auth\.", "lock\."\]/);
  });
});
