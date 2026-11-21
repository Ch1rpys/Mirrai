import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";
import { copy } from "@shared/copy";
import { hashPassword } from "../_core/password";
import { formatErrorForClient } from "../_core/trpc";
import { rateLimiter } from "../_core/rate-limit";
import { generateDataKey, unwrapDataKeyWithPassword, wrapDataKeyForPassword } from "../_core/content-crypto";
import { forgetAllDataKeys, hasDataKey } from "../_core/data-keys";

/**
 * The encrypted account's unlock routes and the guard in front of every
 * data route (C8.5).
 *
 * The promise: an account whose content is encrypted is unreadable until
 * its data key is in memory, and the only way to put it there is the
 * account password (or the recovery code, tested with the crypto
 * primitives). `encryption.status` and `encryption.unlock` stay
 * reachable while the data is refused, which is what the interface
 * needs to draw the unlock screen.
 */

const getUserById = vi.fn();
const getPersonasWithStats = vi.fn();
const setUserEncryption = vi.fn();
const updateUserPassword = vi.fn();
const bumpUserTokenVersion = vi.fn();

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getPersonasWithStats: (...a: unknown[]) => getPersonasWithStats(...a),
  setUserEncryption: (...a: unknown[]) => setUserEncryption(...a),
  updateUserPassword: (...a: unknown[]) => updateUserPassword(...a),
  bumpUserTokenVersion: (...a: unknown[]) => bumpUserTokenVersion(...a),
}));

import { appRouter } from "../routers";

let dataKey: Buffer;
let wrapped: { wrappedKey: string; salt: string; kdf: "scrypt" };

beforeEach(async () => {
  vi.clearAllMocks();
  forgetAllDataKeys();
  await rateLimiter.reset();
  dataKey = generateDataKey();
  wrapped = await wrapDataKeyForPassword(dataKey, "correct horse");
  const passwordHash = await hashPassword("correct horse");
  getUserById.mockResolvedValue({
    id: 1,
    username: "阿树",
    name: "阿树",
    passwordHash,
    encryption: { enabled: true, ...wrapped, recoveryWrappedKey: "v1:x:y:z" },
    lockSettings: null,
    lockPinHash: null,
    tokenVersion: 0,
    timezone: "Asia/Shanghai",
    locale: "zh",
    role: "user",
  });
  getPersonasWithStats.mockResolvedValue([{ id: 5, name: "小满" }]);
  setUserEncryption.mockResolvedValue(undefined);
  updateUserPassword.mockResolvedValue(undefined);
  bumpUserTokenVersion.mockResolvedValue(undefined);
});

afterEach(() => {
  forgetAllDataKeys();
});

function ctxFor(): TrpcContext {
  return {
    user: {
      id: 1,
      username: "阿树",
      encryption: { enabled: true, ...wrapped },
      lockSettings: null,
      lockPinHash: null,
      timezone: "Asia/Shanghai",
    },
    locale: "zh",
    req: {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      protocol: "http",
      get: (name: string) => (name === "host" ? "localhost:3000" : undefined),
    },
    res: { cookie: () => {}, clearCookie: () => {} },
  } as unknown as TrpcContext;
}

/** A caller whose user has no encryption at all. */
function plaintextCtx(): TrpcContext {
  const ctx = ctxFor() as unknown as { user: Record<string, unknown> };
  ctx.user.encryption = null;
  return ctx as unknown as TrpcContext;
}

describe("the encryption routes", () => {
  it("reports the account's state without the key material", async () => {
    const caller = appRouter.createCaller(ctxFor());
    const status = await caller.encryption.status();
    // The state now also reports a pending enable/disable job (C8.5).
    expect(status).toMatchObject({ enabled: true, unlocked: false, hasRecoveryCode: true });
    expect(status).toMatchObject({ migrating: false, migration: null, migratedAt: null });
    expect(JSON.stringify(status)).not.toContain(wrapped.salt);
    expect(JSON.stringify(status)).not.toContain(wrapped.wrappedKey);
  });

  it("opens with the account password and locks again on demand", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await expect(caller.encryption.unlock({ password: "wrong" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(hasDataKey(1)).toBe(false);

    const opened = await caller.encryption.unlock({ password: "correct horse" });
    expect(opened).toMatchObject({ enabled: true, unlocked: true, hasRecoveryCode: true });
    expect(hasDataKey(1)).toBe(true);

    const locked = await caller.encryption.lock();
    expect(locked.unlocked).toBe(false);
    expect(hasDataKey(1)).toBe(false);
  });

  it("refuses to unlock an account that is not encrypted", async () => {
    getUserById.mockResolvedValue({ id: 1, username: "阿树", encryption: null });
    const caller = appRouter.createCaller(plaintextCtx());
    const denied = await caller.encryption.unlock({ password: "correct horse" }).catch((error) => error);
    expect(denied.code).toBe("BAD_REQUEST");
    expect(denied.message).toBe(copy("zh", "errors.encryptionNotEnabled"));
    await expect(caller.encryption.status()).resolves.toMatchObject({
      enabled: false,
      unlocked: false,
      hasRecoveryCode: false,
      migrating: false,
      migration: null,
    });
  });
});

describe("turning the feature on and off (C8.5 step 6)", () => {
  it("refuses to enable without the two acknowledgements", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      (caller.encryption.enable as unknown as (input: unknown) => Promise<unknown>)({
        password: "correct horse",
      }),
    ).rejects.toBeTruthy();
  });

  it("refuses to enable an account that is already encrypted", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await expect(
      caller.encryption.enable({
        password: "correct horse",
        lostContentUnderstood: true,
        restartUnderstood: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses to disable an account with no encryption", async () => {
    getUserById.mockResolvedValue({
      id: 1,
      username: "阿树",
      passwordHash: await hashPassword("correct horse"),
      encryption: null,
    });
    const caller = appRouter.createCaller(plaintextCtx());
    const denied = await caller.encryption.disable({ password: "correct horse" }).catch((error) => error);
    expect(denied.code).toBe("BAD_REQUEST");
    expect(denied.message).toBe(copy("zh", "errors.encryptionNotEnabled"));
  });

  it("refuses to recover an account that has no recovery code", async () => {
    getUserById.mockResolvedValue({
      id: 1,
      username: "阿树",
      passwordHash: await hashPassword("correct horse"),
      encryption: { enabled: true, ...wrapped },
    });
    const caller = appRouter.createCaller(ctxFor());
    const denied = await caller.encryption
      .recover({ recoveryCode: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ", newPassword: "a new password" })
      .catch((error) => error);
    expect(denied.code).toBe("BAD_REQUEST");
    expect(denied.message).toBe(copy("zh", "errors.encryptionRecoveryMissing"));
  });
});

describe("the guard in front of the data", () => {
  it("refuses a data route while the key is missing", async () => {
    const caller = appRouter.createCaller(ctxFor());
    const denied = await caller.persona.list().catch((error) => error);
    expect(denied.code).toBe("FORBIDDEN");
    expect(denied.mirraiCode).toBe("ENCRYPTION_LOCKED");
    expect(getPersonasWithStats).not.toHaveBeenCalled();
  });

  it("lets the unlock routes through while the data is refused", async () => {
    const caller = appRouter.createCaller(ctxFor());
    await expect(caller.encryption.status()).resolves.toBeTruthy();
    await caller.encryption.unlock({ password: "correct horse" });
    await expect(caller.persona.list()).resolves.toEqual([{ id: 5, name: "小满" }]);
  });

  it("names the lock in data.code so the interface can ask for the password", () => {
    const error = Object.assign(
      new TRPCError({ code: "FORBIDDEN", message: "locked" }),
      { mirraiCode: "ENCRYPTION_LOCKED" },
    );
    const formatted = formatErrorForClient({
      shape: { message: "locked", code: -32003, data: {} },
      error,
      ctx: { locale: "zh" },
    });
    expect(formatted.data.code).toBe("ENCRYPTION_LOCKED");
  });
});

describe("changing the password", () => {
  it("wraps the same data key with the new password", async () => {
    const caller = appRouter.createCaller(ctxFor());
    const result = await caller.user.changePassword({
      currentPassword: "correct horse",
      newPassword: "the new password",
    });
    expect(result.success).toBe(true);
    expect(updateUserPassword).toHaveBeenCalledTimes(1);

    const [, patch] = setUserEncryption.mock.calls.at(-1) as [number, Record<string, unknown>];
    expect(patch.enabled).toBe(true);
    expect(patch.recoveryWrappedKey).toBe("v1:x:y:z");
    const newWrappedKey = String(patch.wrappedKey);
    const newSalt = String(patch.salt);
    // The old password must not open the new wrapping; the new one must.
    expect(await unwrapDataKeyWithPassword(newWrappedKey, newSalt, "correct horse")).toBeNull();
    const opened = await unwrapDataKeyWithPassword(newWrappedKey, newSalt, "the new password");
    expect(opened?.equals(dataKey)).toBe(true);
    // And the account stays unlocked in this process.
    expect(hasDataKey(1)).toBe(true);
  }, 30_000);
});
