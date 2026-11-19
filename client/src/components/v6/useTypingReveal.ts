/**
 * When the dots appear and disappear is theirs, not the model's.
 *
 * A delay waits in silence first, then shows the three dots for the
 * typing stretch, then the words. A burst does the same between lines,
 * so the dots come and go to the rhythm that was measured. Stopping
 * the turn clears every timer; nothing else is written after that.
 */

export type RevealClock = (ms: number, signal?: AbortSignal) => Promise<void>;

export function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function revealDelay(options: {
  ms: number;
  typingMs?: number;
  signal?: AbortSignal;
  setDots: (on: boolean) => void;
  wait?: RevealClock;
}): Promise<void> {
  const wait = options.wait ?? waitMs;
  const total = Math.min(Math.max(0, options.ms), 90_000);
  const typing = options.typingMs != null
    ? Math.min(Math.max(0, options.typingMs), total)
    : undefined;
  if (options.signal?.aborted) return;
  if (typing == null) {
    await wait(total, options.signal);
    return;
  }
  options.setDots(false);
  const quiet = total - typing;
  if (quiet > 0) await wait(quiet, options.signal);
  if (options.signal?.aborted) return;
  options.setDots(true);
  if (typing > 0) await wait(typing, options.signal);
}

export async function revealBurst(options: {
  texts: string[];
  gapsMs?: number[];
  typingMs?: number[];
  signal?: AbortSignal;
  setDots: (on: boolean) => void;
  show: (texts: string[]) => void;
  wait?: RevealClock;
}): Promise<void> {
  const { texts, gapsMs, typingMs, signal, setDots, show } = options;
  const wait = options.wait ?? waitMs;
  if (!gapsMs || gapsMs.length === 0) {
    show(texts);
    return;
  }
  const typingAt = (index: number): number => {
    if (!typingMs || typingMs.length === 0) return 0;
    if (typingMs.length === texts.length) return typingMs[index] ?? 0;
    return typingMs[index - 1] ?? 0;
  };
  for (let i = 0; i < texts.length; i++) {
    if (signal?.aborted) return;
    if (i === 0) {
      const typing = typingAt(0);
      if (typing > 0) {
        setDots(true);
        await wait(typing, signal);
        if (signal?.aborted) return;
      }
      show(texts.slice(0, 1));
      setDots(false);
      continue;
    }
    const gap = Math.max(0, gapsMs[i - 1] ?? 0);
    const typing = Math.min(typingAt(i), gap);
    const quiet = gap - typing;
    setDots(false);
    if (quiet > 0) await wait(quiet, signal);
    if (signal?.aborted) return;
    if (typing > 0) {
      setDots(true);
      await wait(typing, signal);
      if (signal?.aborted) return;
    }
    show(texts.slice(0, i + 1));
    setDots(false);
  }
}

export function useTypingReveal() {
  return { revealDelay, revealBurst };
}
