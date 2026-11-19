/**
 * The inbox of one conversation: one user talking to one persona.
 *
 * A later message can replace a reply that has not been written yet.
 * The generation number is what says which arrival is current, and the
 * phase is what says whether that reply can still be taken away.
 */
export const READ_WINDOW_MS = 2500;
/** Channels merge a burst even when timing is off: people there type in a row. */
export const CHANNEL_READ_WINDOW_MS = 4000;

/**
 * How long to wait between two channel bubbles when typing was not measured.
 *
 * 250 ms a character, never shorter than 600 ms or longer than 8 s.
 */
export function fallbackChannelGapMs(text: string): number {
  const chars = Array.from(text).length;
  return Math.min(8_000, Math.max(600, chars * 250));
}

export type InboxPhase = "idle" | "waiting" | "generating" | "committing";

interface Inbox {
  generation: number;
  phase: InboxPhase;
  controller: AbortController | null;
}

const inboxes = new Map<string, Inbox>();

export function inboxKey(userId: number, personaId: number): string {
  return `${userId}:${personaId}`;
}

function inboxOf(key: string): Inbox {
  let inbox = inboxes.get(key);
  if (!inbox) {
    inbox = { generation: 0, phase: "idle", controller: null };
    inboxes.set(key, inbox);
  }
  return inbox;
}

/**
 * A new message has arrived.
 *
 * Returns the generation that belongs to this arrival. A turn that is
 * still waiting or generating is aborted with `"superseded"`; a turn
 * that has started writing its reply is left alone.
 */
export function arrive(key: string): number {
  const inbox = inboxOf(key);
  inbox.generation += 1;
  if (inbox.phase === "waiting" || inbox.phase === "generating") {
    inbox.controller?.abort("superseded");
  }
  return inbox.generation;
}

export function isLatest(key: string, generation: number): boolean {
  return inboxOf(key).generation === generation;
}

export function currentGeneration(key: string): number {
  return inboxOf(key).generation;
}

export function enter(
  key: string,
  phase: InboxPhase,
  controller?: AbortController,
): void {
  const inbox = inboxOf(key);
  inbox.phase = phase;
  if (phase === "committing" || phase === "idle") {
    inbox.controller = null;
    return;
  }
  if (controller) inbox.controller = controller;
}

/**
 * The turn with this generation is finished.
 *
 * A later arrival keeps its own phase: leaving an old generation must
 * not wipe the inbox the newer one just entered.
 */
export function leave(key: string, generation: number): void {
  const inbox = inboxes.get(key);
  if (!inbox || inbox.generation !== generation) return;
  inbox.phase = "idle";
  inbox.controller = null;
}

export function isSupersededSignal(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted && signal.reason === "superseded");
}

export function abortError(signal?: AbortSignal): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  if (signal?.reason !== undefined) {
    (error as Error & { cause?: unknown }).cause = signal.reason;
  }
  return error;
}

export function waitAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(abortError(signal));
    };
    if (signal?.aborted) {
      fail();
      return;
    }
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", fail);
      resolve();
    }, ms);
    signal?.addEventListener("abort", fail, { once: true });
  });
}

export function combineSignals(
  a?: AbortSignal,
  b?: AbortSignal,
): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const controller = new AbortController();
  const forward = (signal: AbortSignal) => {
    if (signal.aborted) controller.abort(signal.reason);
    else {
      signal.addEventListener(
        "abort",
        () => controller.abort(signal.reason),
        { once: true },
      );
    }
  };
  forward(a);
  forward(b);
  return controller.signal;
}

/** Test helper: one file's leftover generation must not leak into the next. */
export function resetInbox(): void {
  inboxes.clear();
}
