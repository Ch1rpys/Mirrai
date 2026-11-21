import { useSyncExternalStore } from "react";

/**
 * Whether the encrypted database is locked (C8.5).
 *
 * An encrypted account's key lives in the server process's memory, not
 * in the session cookie. A server restart therefore leaves a valid
 * session with no key: every data request comes back
 * `ENCRYPTION_LOCKED` until the account password is entered again. The
 * interface has to stop showing the data it already has on screen and
 * ask for the password — the same arrangement as the app lock (C8.4),
 * for the same reason.
 *
 * It is a module store rather than React state because the events arrive
 * from the tRPC cache callbacks in `main.tsx`, outside any component.
 */
let locked = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** The server refused a request because the encrypted content is locked. */
export function markEncryptionLocked(): void {
  if (locked) return;
  locked = true;
  notify();
}

/** The account password brought the key back. */
export function clearEncryptionLocked(): void {
  if (!locked) return;
  locked = false;
  notify();
}

/** Whether the unlock screen is up. */
export function encryptionLocked(): boolean {
  return locked;
}

/** Puts the store back to "open". Tests only. */
export function resetEncryptionLockForTests(): void {
  locked = false;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding: true while the unlock screen should be up. */
export function useEncryptionLocked(): boolean {
  return useSyncExternalStore(subscribe, encryptionLocked, () => false);
}
