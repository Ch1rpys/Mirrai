import { TRPCClientError } from "@trpc/client";

/**
 * What the client does with one failed API call (C8.4, C8.5).
 *
 * The two lock states are not transport codes: tRPC's code set is
 * closed, so the server puts the app's own name in `data.code`. The
 * handler lives here rather than inline in `main.tsx` so a test can
 * prove the wiring — the lock screen appearing from a `LOCKED` answer
 * was the one link nobody exercised.
 */
export const isLockedError = (error: unknown): boolean =>
  error instanceof TRPCClientError && error.data?.code === "LOCKED";

export const isEncryptionLockedError = (error: unknown): boolean =>
  error instanceof TRPCClientError && error.data?.code === "ENCRYPTION_LOCKED";

export const isUnauthorizedError = (error: unknown): boolean =>
  error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED";

export interface ApiErrorActions {
  /** Show the lock screen. */
  markAppLocked: () => void;
  /** Show the "enter your password to decrypt" screen. */
  markEncryptionLocked: () => void;
  /** Send the reader to the sign-in page. */
  redirectToLogin: () => void;
  /** Log the error (the cache subscribers' console line). */
  report: (error: unknown) => void;
}

/**
 * Routes one error to the screen that should be showing.
 *
 * Returns what it did, so a caller (and a test) can see the decision.
 * The lock screens win over everything else: a locked answer is not a
 * reason to sign out or to show a toast over the lobby.
 */
export function handleApiError(
  error: unknown,
  actions: ApiErrorActions,
): "locked" | "encryption-locked" | "unauthorized" | "reported" {
  if (isLockedError(error)) {
    actions.markAppLocked();
    return "locked";
  }
  if (isEncryptionLockedError(error)) {
    actions.markEncryptionLocked();
    return "encryption-locked";
  }
  if (isUnauthorizedError(error)) {
    actions.redirectToLogin();
    return "unauthorized";
  }
  actions.report(error);
  return "reported";
}
