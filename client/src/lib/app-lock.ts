import { useSyncExternalStore } from "react";

/**
 * Whether the app lock has closed the interface (C8.4).
 *
 * Any request that comes back `LOCKED` means the server has closed this
 * session: the interface has to stop showing the data it already has on
 * screen — a lobby full of conversations stays readable otherwise — and
 * cover everything with the lock screen.
 *
 * It is a plain module store rather than React state because the events
 * arrive from the tRPC client's cache callbacks in `main.tsx`, outside
 * any component. `useSyncExternalStore` keeps the components in step
 * without a provider.
 */
let locked = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** The server refused a request because the session is locked. */
export function markAppLocked(): void {
  if (locked) return;
  locked = true;
  notify();
}

/** A PIN, a password or a passkey opened the session. */
export function clearAppLocked(): void {
  if (!locked) return;
  locked = false;
  notify();
}

/** Whether the lock screen is up. */
export function appLocked(): boolean {
  return locked;
}

/** Puts the store back to "open". Tests only. */
export function resetAppLockForTests(): void {
  locked = false;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding: true while the lock screen should be up. */
export function useAppLocked(): boolean {
  return useSyncExternalStore(subscribe, appLocked, () => false);
}
