import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The words in the input box that have not been sent (C8.10).
 *
 * A half-written message lived only in React state — so switching to
 * another persona, or reloading the page, threw it away without asking.
 * It is stored per user and per conversation, under one key prefix, so
 * signing out can clear every draft at once.
 *
 * The storage is read in a try/catch: a browser that refuses it (private
 * mode, no storage permission) gets a working input with no memory
 * rather than a broken page.
 */
const PREFIX = "mirrai:draft:";

function keyFor(userId: number | null | undefined, personaId: number): string {
  return `${PREFIX}${userId ?? "anon"}:${personaId}`;
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // No storage: the draft lives in memory for this page only.
  }
}

export function useDraft(
  userId: number | null | undefined,
  personaId: number,
): { value: string; setValue: (next: string) => void; clear: () => void } {
  const [value, setValueState] = useState(() => read(keyFor(userId, personaId)));
  const keyRef = useRef(keyFor(userId, personaId));

  // A different conversation has a different draft.
  useEffect(() => {
    const next = keyFor(userId, personaId);
    if (next === keyRef.current) return;
    keyRef.current = next;
    setValueState(read(next));
  }, [userId, personaId]);

  // Every keystroke is remembered; the empty value removes the entry.
  useEffect(() => {
    write(keyRef.current, value);
  }, [value]);

  const setValue = useCallback((next: string) => setValueState(next), []);
  const clear = useCallback(() => setValueState(""), []);
  return { value, setValue, clear };
}

/** Every draft, for signing out (C8.10). The drafts are not left behind. */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Nothing to clear when there is no storage.
  }
}
