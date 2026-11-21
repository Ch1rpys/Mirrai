import { describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { handleApiError } from "./error-handling";

/**
 * One failed API call, routed to the right screen.
 *
 * The LOCKED wiring in `main.tsx` used to be untested: the lock screen
 * tests called `markAppLocked()` directly. This file pins the actual
 * decision — a `data.code` of LOCKED must put the lock screen up, an
 * ENCRYPTION_LOCKED must ask for the password, UNAUTHORIZED goes to the
 * sign-in page, anything else is just reported.
 */

function trpcError(code: string) {
  return new TRPCClientError("boom", {
    result: {
      error: { code: -32003, message: "boom", data: { code } },
    } as never,
  });
}

function actions() {
  return {
    markAppLocked: vi.fn(),
    markEncryptionLocked: vi.fn(),
    redirectToLogin: vi.fn(),
    report: vi.fn(),
  };
}

describe("handleApiError", () => {
  it("opens the lock screen for LOCKED", () => {
    const handlers = actions();
    expect(handleApiError(trpcError("LOCKED"), handlers)).toBe("locked");
    expect(handlers.markAppLocked).toHaveBeenCalledTimes(1);
    expect(handlers.markEncryptionLocked).not.toHaveBeenCalled();
    expect(handlers.redirectToLogin).not.toHaveBeenCalled();
    expect(handlers.report).not.toHaveBeenCalled();
  });

  it("asks for the password for ENCRYPTION_LOCKED", () => {
    const handlers = actions();
    expect(handleApiError(trpcError("ENCRYPTION_LOCKED"), handlers)).toBe("encryption-locked");
    expect(handlers.markEncryptionLocked).toHaveBeenCalledTimes(1);
    expect(handlers.markAppLocked).not.toHaveBeenCalled();
  });

  it("sends an expired session to the sign-in page", () => {
    const handlers = actions();
    expect(handleApiError(trpcError("UNAUTHORIZED"), handlers)).toBe("unauthorized");
    expect(handlers.redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it("reports every other error", () => {
    const handlers = actions();
    const error = trpcError("INTERNAL_SERVER_ERROR");
    expect(handleApiError(error, handlers)).toBe("reported");
    expect(handlers.report).toHaveBeenCalledWith(error);
    expect(handlers.markAppLocked).not.toHaveBeenCalled();
    expect(handlers.markEncryptionLocked).not.toHaveBeenCalled();
    expect(handlers.redirectToLogin).not.toHaveBeenCalled();
  });

  it("does not treat a plain Error as a lock", () => {
    const handlers = actions();
    expect(handleApiError(new Error("network"), handlers)).toBe("reported");
    expect(handlers.markAppLocked).not.toHaveBeenCalled();
  });
});
