/**
 * Phone mode (B7.14).
 *
 * A WebSocket that carries a spoken conversation. It is the same
 * conversation path as the chat — the same inbox, crisis handling,
 * memory and daily limits — with two additions: what the user says is
 * transcribed before it reaches the model, and each sentence of the
 * reply is synthesised and sent back as audio.
 *
 * The upgrade is where the safety lives: a session cookie, an Origin
 * that belongs to this app, a persona the user owns with the switch on,
 * a transcription engine and a read-aloud engine. Any of them missing
 * and the socket is refused.
 */
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { authenticateRequest } from "../_core/auth";
import { personaLocked, refreshRequestLock, sessionKeyFromRequest } from "../_core/app-lock";
import { ENV } from "../_core/env";
import { copy } from "@shared/copy";
import { mergePersonaSettings, normalizePersonaSettings } from "@shared/persona-settings";
import { effectiveStyleProfile } from "@shared/style-profile";
import { zonedHour, zonedWeekday } from "@shared/timezone";
import { getPersonaById, setMessageContent } from "../db";
import { getMessagesByPersonaId } from "../db";
import { sttConfigured, sttEngine, transcribeAudio } from "../_core/stt";
import { generateTTS, DEFAULT_VOICE, ttsConfigured } from "../_core/tts";
import { resolveProviderForUser } from "../llm/user-provider";
import type { LLMProvider } from "../llm/types";
import { resolveStoredPath } from "../storage";
import { runConversation } from "./service";
import type { Locale } from "@shared/copy";

/** A call is cut off after an hour. */
export const CALL_MAX_MS = 60 * 60_000;
/** Consecutive silence that ends an utterance, in milliseconds. */
export const UTTERANCE_SILENCE_MS = 700;

export interface CallUser {
  id: number;
  name?: string | null;
  timezone?: string | null;
  locale?: Locale;
}

export interface CallPersona {
  id: number;
  userId: number;
  name: string;
  settings?: unknown;
  styleProfile?: unknown;
  timezone?: string | null;
  /** The provider the persona's chat uses, for the provider STT engine. */
  llmProvider?: string | null;
}

export interface CallDeps {
  authenticate: (request: unknown) => Promise<CallUser>;
  getPersona: (personaId: number, userId: number) => Promise<CallPersona | null | undefined>;
  /** The provider used by the provider STT engine. Tests replace it. */
  resolveProvider: (input: {
    userId: number;
    providerName?: string;
  }) => Promise<LLMProvider | null>;
  transcribe: (input: {
    buffer: Buffer;
    fileName: string;
    purpose: "chat";
    provider?: LLMProvider;
  }) => Promise<{ text: string } | null>;
  /**
   * Synthesises one sentence.
   *
   * `signal` is the turn's own abort signal: the engines cannot be
   * stopped halfway, but the clip they are making must not be used once
   * the user has interrupted. A synthesiser that can check it returns
   * `null` instead of a clip the call no longer wants.
   */
  synthesize: (
    text: string,
    userId: number,
    options?: { signal?: AbortSignal },
  ) => Promise<Buffer | null>;
  converse: (options: {
    persona: CallPersona;
    userId: number;
    message: string;
    mode: "stream";
    channel: "web";
    now: Date;
    locale: Locale;
    signal?: AbortSignal;
  }) => AsyncGenerator<Record<string, unknown>>;
  trimReply: (personaId: number, userId: number, since: Date, content: string) => Promise<void>;
  now: () => Date;
  /**
   * Whether the app lock (C8.4) covers this socket.
   *
   * The socket is not tRPC, so `protectedProcedure`'s guard never runs
   * for it. The real one asks `refreshRequestLock`; a test that does not
   * care about the lock leaves the default.
   */
  locked: (request: unknown, user: CallUser) => Promise<boolean>;
}

function defaultTrimReply(): CallDeps["trimReply"] {
  return async (personaId, userId, since, content) => {
    const rows = await getMessagesByPersonaId(personaId, userId, 5);
    const latest = rows.find(
      (row) => row.role === "assistant" && new Date(row.createdAt).getTime() >= since.getTime(),
    );
    if (latest) await setMessageContent(latest.id, userId, content);
  };
}

const REAL_DEPS: CallDeps = {
  authenticate: async (request) => {
    const user = await authenticateRequest(request as never);
    return user as unknown as CallUser;
  },
  getPersona: async (personaId, userId) =>
    ((await getPersonaById(personaId, userId)) as unknown as CallPersona | undefined) ?? null,
  resolveProvider: async (input) => (await resolveProviderForUser(input)) ?? null,
  transcribe: (input) => transcribeAudio({ ...input, fileName: input.fileName }),
  synthesize: async (text, userId, options = {}) => {
    const url = await generateTTS(text, DEFAULT_VOICE, userId);
    /**
     * The engines run to completion — piper is a subprocess and edge is
     * an HTTP call — so cancellation happens here, at the boundary: a
     * clip whose turn was interrupted while it was being made is read
     * for nobody. It stays cached, so saying the same words again is a
     * cache hit rather than another synthesis.
     */
    if (options.signal?.aborted) return null;
    const path = resolveStoredPath(url);
    if (!path) return null;
    return readFile(path);
  },
  converse: (options) => runConversation(options as never) as AsyncGenerator<Record<string, unknown>>,
  trimReply: defaultTrimReply(),
  now: () => new Date(),
  locked: async (request, user) => refreshRequestLock(request as never, user as never),
};

/**
 * Waits for a synthesis, but stops waiting the moment the turn is
 * interrupted.
 *
 * The speech engines have no per-clip cancellation: a piper subprocess
 * and an edge request run to the end whether or not anyone still wants
 * the bytes. What can be cancelled is the wait — the turn must give up
 * on the clip at once, so the next thing the user said is heard instead
 * of queued behind an answer they already stopped. The signal is also
 * handed to the synthesiser so it can drop the result on its side.
 *
 * Resolves `null` on abort, or when the synthesis fails: a sentence
 * without audio is a text reply, not an error.
 */
function synthesizeUntilAborted(
  synthesize: CallDeps["synthesize"],
  text: string,
  userId: number,
  signal: AbortSignal,
): Promise<Buffer | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Buffer | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    signal.addEventListener("abort", onAbort, { once: true });
    synthesize(text, userId, { signal }).then(
      // The clip may have finished in the same tick the interrupt was
      // processed; then it belongs to the answer the user stopped.
      (value) => finish(signal.aborted ? null : value),
      () => finish(null),
    );
  });
}

/** Splits a reply into spoken sentences. */
export function splitCallSentences(text: string): string[] {
  return String(text ?? "")
    .split(/(?<=[。！？!?\n])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Whether the persona is inside one of the slots they answer in.
 *
 * An empty list is "the records have no usual time", not "any time":
 * the manual asks the call to be declined when there are slots and the
 * current moment is not one of them, and with no slot there is no
 * recorded time to be inside. `begin` only calls this when the records
 * contain a call measurement at all; a persona with no call data has no
 * slots to check and is allowed.
 */
export function isAnswerSlot(
  slots: Array<{ weekday: number; hour: number }>,
  now: Date,
  timeZone?: string | null,
): boolean {
  if (slots.length === 0) return false;
  const weekday = zonedWeekday(now, timeZone);
  const hour = zonedHour(now, timeZone);
  return slots.some((slot) => slot.weekday === weekday && slot.hour === hour);
}

function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    // A browser sends an http(s) origin. Comparing only the host let
    // `ftp://same-host` through the same check.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (host && parsed.host === host) return true;
    return ENV.allowedOrigins.some((allowed) => allowed.replace(/\/$/, "") === origin.replace(/\/$/, ""));
  } catch {
    return false;
  }
}

async function reject(socket: import("node:stream").Duplex, status: string): Promise<void> {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export interface CallServer {
  close: () => void;
  active: Map<number, WebSocket>;
}

/**
 * Attaches the call socket to an HTTP server.
 *
 * `overrides` exists for the test: the conversation, the transcriber
 * and the synthesiser are the expensive parts, and the protocol is what
 * has to be right.
 */
export function attachCallServer(server: Server, overrides: Partial<CallDeps> = {}): CallServer {
  const deps: CallDeps = { ...REAL_DEPS, ...overrides };
  const wss = new WebSocketServer({ noServer: true });
  const active = new Map<number, WebSocket>();

  const onUpgrade = (request: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    void (async () => {
      let url: URL;
      try {
        url = new URL(request.url ?? "", "http://localhost");
      } catch {
        await reject(socket, "400 Bad Request");
        return;
      }
      if (url.pathname !== "/api/call") return;
      const personaId = Number.parseInt(url.searchParams.get("personaId") ?? "", 10);
      if (!Number.isInteger(personaId) || personaId <= 0) {
        await reject(socket, "400 Bad Request");
        return;
      }
      if (!originAllowed(request.headers.origin, request.headers.host)) {
        await reject(socket, "403 Forbidden");
        return;
      }
      let user: CallUser;
      try {
        user = await deps.authenticate(request);
      } catch {
        await reject(socket, "401 Unauthorized");
        return;
      }
      /**
       * The app lock covers the phone socket too (C8.4): a spoken
       * conversation is the persona's voice, and it must not start from
       * a session that has not been unlocked.
       */
      if (await deps.locked(request, user).catch(() => true)) {
        await reject(socket, "403 Forbidden");
        return;
      }
      const persona = await deps.getPersona(personaId, user.id).catch(() => null);
      if (!persona || persona.userId !== user.id) {
        await reject(socket, "404 Not Found");
        return;
      }
      /**
       * A locked persona does not answer the phone either. The PIN was
       * proved recently enough if the same session just unlocked.
       */
      if (await personaLocked(
        normalizePersonaSettings(persona.settings),
        sessionKeyFromRequest(request),
      )) {
        await reject(socket, "403 Forbidden");
        return;
      }
      const settings = normalizePersonaSettings(persona.settings);
      if (!settings.layers.callMode) {
        await reject(socket, "403 Forbidden");
        return;
      }
      /**
       * Both engines have to be able to run, not merely be configured
       * to a value other than `off`. A whisper.cpp engine without its
       * binary would accept the call and then say "not heard" to every
       * utterance; a piper engine without its model would answer only
       * in text. The upgrade is the place to say so.
       */
      if (!sttConfigured() || !ttsConfigured()) {
        await reject(socket, "503 Service Unavailable");
        return;
      }
      /**
       * The provider engine is the user's own provider. Without one
       * there is nothing to transcribe with; the default environment
       * says `provider`, which is not the same as a configured one.
       */
      let provider: LLMProvider | null = null;
      if (sttEngine() === "provider") {
        provider = await deps.resolveProvider({
          userId: user.id,
          providerName: persona.llmProvider ?? undefined,
        }).catch(() => null);
        if (!provider) {
          await reject(socket, "503 Service Unavailable");
          return;
        }
      }
      if (active.has(user.id)) {
        await reject(socket, "409 Conflict");
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, { user, persona, provider });
      });
    })().catch(() => {
      if (!socket.destroyed) socket.destroy();
    });
  };

  server.on("upgrade", onUpgrade);

  wss.on("connection", (ws: WebSocket, _request: unknown, extra: unknown) => {
    const { user, persona, provider } = extra as {
      user: CallUser;
      persona: CallPersona;
      provider: LLMProvider | null;
    };
    active.set(user.id, ws);
    const startedAt = deps.now();
    let started = false;
    let ended = false;
    /** The turn currently speaking; an interrupt aborts it. */
    let currentTurn: { interrupt: () => void } | null = null;
    /**
     * One turn at a time.
     *
     * The microphone stays live while the answer plays, so a second
     * utterance can arrive before the first turn has finished. Starting
     * both would interleave two replies and restart `seq` at zero; the
     * next one waits its turn instead.
     */
    let turnRunning = false;
    const pendingAudio: Buffer[] = [];
    const locale = user.locale === "en" ? "en" : "zh";
    const maxTimer = setTimeout(() => {
      send(ws, { type: "error", message: copy(locale, "call.tooLong") });
      close();
    }, CALL_MAX_MS);
    maxTimer.unref?.();

    function send(socket: WebSocket, payload: Record<string, unknown>) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    }
    function audio(socket: WebSocket, bytes: Buffer) {
      if (socket.readyState === socket.OPEN) socket.send(bytes);
    }
    function close() {
      if (ended) return;
      ended = true;
      clearTimeout(maxTimer);
      active.delete(user.id);
      try {
        ws.close();
      } catch {
        // already gone
      }
    }

    async function begin(force: boolean) {
      if (started) return;
      const calls = effectiveStyleProfile(persona).calls;
      /**
       * A persona with no call measurement has no recorded answering
       * habit, so there is nothing to check. One that has calls is only
       * reachable in the slots it answered in before — even when no
       * slot repeated often enough to be kept, which is "no usual
       * time", and the user can still force the call through.
       */
      if (calls) {
        const slots = calls.answerSlots ?? [];
        if (!force && !isAnswerSlot(slots, deps.now(), persona.timezone ?? user.timezone)) {
          send(ws, { type: "declined", slots });
          return;
        }
      }
      started = true;
      send(ws, { type: "ready" });
    }

    async function turn(bytes: Buffer) {
      const heard = await deps.transcribe({
        buffer: bytes,
        fileName: "call.webm",
        purpose: "chat",
        ...(provider ? { provider } : {}),
      }).catch(() => null);
      const text = heard?.text?.trim();
      if (!text) {
        send(ws, { type: "error", message: copy(locale, "call.notHeard") });
        return;
      }
      send(ws, { type: "transcript", text });
      const turnStart = deps.now();
      let reply = "";
      let crisis = false;
      let interrupted = false;
      let sentText = "";
      const controller = new AbortController();
      currentTurn = {
        interrupt: () => {
          interrupted = true;
          controller.abort();
        },
      };
      try {
        /**
         * A call is only the voice turn.
         *
         * No waiting, no burst splitting, no stickers or voice notes or
         * photo bubbles: each of those is a web-chat behaviour, and the
         * call's own protocol has no room for them.
         */
        const callPersona = {
          ...persona,
          timingEnabled: false,
          settings: mergePersonaSettings(normalizePersonaSettings(persona.settings), {
            layers: {
              stickers: false,
              voiceNotes: false,
              photos: false,
              abPairs: false,
            },
            // A recall is a web-chat gesture. Recalling a line and
            // writing it back as a small notice has no audio form, and
            // the call protocol has no event for it.
            timing: { recall: false },
          }),
        };
        for await (const event of deps.converse({
          persona: callPersona,
          userId: user.id,
          message: text,
          mode: "stream",
          channel: "web",
          now: turnStart,
          locale,
          signal: controller.signal,
        })) {
          if (event.type === "delta" && typeof event.text === "string") reply += event.text;
          /**
           * A projection (B3.4) arrives as a replacement for what was
           * streamed before it. The web chat applies it; the call was
           * only collecting deltas, so it spoke the unprojected text.
           */
          if (event.type === "replace" && typeof event.text === "string") reply = event.text;
          if (event.type === "done") {
            if (event.crisis === true) crisis = true;
          }
          if (event.type === "interrupted") interrupted = true;
        }
      } catch {
        // Do not leave an interrupt pointing at a turn nobody is
        // waiting on any more.
        currentTurn = null;
        if (!controller.signal.aborted) {
          send(ws, { type: "error", message: copy(locale, "call.replyFailed") });
        }
        return;
      }
      if (crisis) send(ws, { type: "crisis" });
      const sentences = splitCallSentences(reply);
      for (const [seq, sentence] of sentences.entries()) {
        if (interrupted || controller.signal.aborted) break;
        send(ws, { type: "reply", text: sentence, seq });
        /**
         * The words went out with the reply frame. A clip abandoned by
         * an interrupt still leaves its sentence in the transcript: the
         * text frame is what was already sent, even when its audio is
         * not.
         */
        sentText += sentence;
        const voice = await synthesizeUntilAborted(
          deps.synthesize,
          sentence,
          user.id,
          controller.signal,
        );
        /**
         * The clip was already being made when the interrupt came. It
         * belongs to the answer the user stopped, so its bytes must not
         * follow the acknowledgement — on the wire or in the ears.
         */
        if (interrupted || controller.signal.aborted) break;
        if (voice) audio(ws, voice);
      }
      currentTurn = null;
      if (interrupted) {
        await deps.trimReply(persona.id, user.id, turnStart, sentText).catch(() => {});
      } else {
        send(ws, { type: "turn-end" });
      }
    }

    async function runQueued(bytes: Buffer) {
      if (turnRunning) {
        pendingAudio.push(bytes);
        return;
      }
      turnRunning = true;
      try {
        await turn(bytes);
      } finally {
        turnRunning = false;
        const next = pendingAudio.shift();
        if (next) void runQueued(next);
      }
    }

    ws.on("message", (data, isBinary) => {
      if (ended) return;
      if (isBinary) {
        if (!started) return;
        void runQueued(Buffer.from(data as Buffer));
        return;
      }
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message.type === "start") {
        void begin(message.force === true);
      } else if (message.type === "interrupt") {
        /**
         * Abort the turn in flight.
         *
         * The generation is cut through its abort signal, and any clip
         * the synthesiser is already making is abandoned: the turn stops
         * waiting for it, and its bytes never follow this acknowledgement.
         * Only the clips already sent stay in the answer.
         */
        currentTurn?.interrupt();
        send(ws, { type: "interrupt-ack" });
      } else if (message.type === "hangup") {
        const seconds = Math.max(0, Math.round((deps.now().getTime() - startedAt.getTime()) / 1000));
        void import("../db").then((db) =>
          db.createMessage({
            personaId: persona.id,
            userId: user.id,
            role: "assistant",
            content: copy(locale, "call.durationNotice", {
              minutes: Math.floor(seconds / 60),
              seconds: String(seconds % 60).padStart(2, "0"),
            }),
            origin: "system-notice",
            channel: "web",
          }),
        ).catch(() => {});
        close();
      }
    });

    ws.on("close", () => {
      if (ended) return;
      ended = true;
      clearTimeout(maxTimer);
      active.delete(user.id);
    });
  });

  return {
    active,
    close: () => {
      server.off("upgrade", onUpgrade);
      for (const socket of active.values()) socket.close();
      active.clear();
      wss.close();
    },
  };
}

/** A server that only serves the call socket, for tests and tools. */
export function createCallOnlyServer(deps: Partial<CallDeps> = {}): {
  server: Server;
  call: CallServer;
  listen: (port?: number) => Promise<number>;
} {
  const server = createServer();
  const call = attachCallServer(server, deps);
  return {
    server,
    call,
    listen: (port = 0) =>
      new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      }),
  };
}
