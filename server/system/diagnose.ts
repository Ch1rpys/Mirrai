/**
 * The one-click diagnosis (C8.12).
 *
 * The user presses one button and the app checks itself: the database, the
 * migrations, Redis, every model the user configured, the local tools, the
 * push path, the channels, the background work and the disk. Each check is
 * bounded (ten seconds), each runs in its own `try`, and one failing tells
 * the reader nothing about the others.
 *
 * This module is the *logic*. It never touches the database, the network or
 * the filesystem itself — everything it needs arrives through `DiagnoseDeps`
 * — which is what lets the tests run every state of every check without a
 * model, a network or a clock.
 *
 * What it produces is a list of `{ id, status, detail, fix? }`. The detail
 * and fix text come from the copy table, and their placeholders are filled
 * with values from a whitelist: counts, sizes, version names, provider and
 * engine names. No error message, API key, message content, username or
 * path is ever passed in — the report is meant to be pasted somewhere.
 */
import { copy, type CopyKey, type Locale } from "@shared/copy";
import {
  sortDiagnoseItems,
  type DiagnoseItem,
  type DiagnoseStatus,
} from "@shared/system-diagnose";
import type { EmbedProbe } from "../chat/embeddings";

/** How long one check may take. */
export const DIAGNOSE_CHECK_TIMEOUT_MS = 10_000;

/**
 * How many files the uploads walk will count.
 *
 * The uploads directory can hold a hundred thousand files; walking it to
 * the end on every diagnosis would make the button slow for the people who
 * have the most to diagnose. Past this many the answer is "more than
 * 50,000", which is the useful part anyway.
 */
export const UPLOAD_FILE_CAP = 50_000;

/** Below this much free disk the diagnosis turns yellow. */
export const LOW_DISK_BYTES = 1024 * 1024 * 1024;

/** A scheduler that has not ticked for this long is not ticking. */
export const SCHEDULER_STALE_MS = 5 * 60_000;

/** One configured model, and the tiny request that proves it answers. */
export interface DiagnoseProviderProbe {
  /** What the user calls it; already safe to show. */
  name: string;
  streaming: boolean;
  vision: boolean;
  transcribe: boolean;
  /** Sends one minimal request. Throws when the provider did not answer. */
  request(signal: AbortSignal): Promise<void>;
}

/**
 * Everything the checks need, bound to one user.
 *
 * A test supplies its own object and every check becomes a pure function of
 * those answers. The server supplies `createDiagnoseDeps()`.
 */
export interface DiagnoseDeps {
  now(): Date;
  /**
   * Whether the database answers. `"no_database"` is "DATABASE_URL is not
   * set", which is a state, not a failure; `"unreachable"` is a database
   * that is configured but does not answer.
   */
  pingDatabase(): Promise<"ok" | "no_database" | "unreachable">;
  /**
   * The newest migration file and the newest applied version. `reachable:
   * false` means the database is there but could not be read — the
   * migrations check then says it was not checked rather than blaming the
   * migrations.
   */
  readMigrationVersions(): Promise<{
    latest: string | null;
    applied: string | null;
    reachable: boolean;
  }>;
  /** The database's size, or null when there is no database. */
  databaseSizeBytes(): Promise<number | null>;
  /** `"absent"` is no Redis anywhere — fine for one process.
   * `"unreachable"` is REDIS_URL set but the store does not answer. */
  redisStatus(): Promise<"ok" | "absent" | "unreachable">;
  listProviders(): Promise<DiagnoseProviderProbe[]>;
  probeOllamaEmbed(): Promise<{ status: EmbedProbe; model: string }>;
  sttStatus(): { engine: string; configured: boolean };
  ttsStatus(): { engine: string; configured: boolean };
  hasFfmpeg(): Promise<boolean>;
  vapidKeysPresent(): Promise<boolean>;
  countPushSubscriptions(): Promise<number>;
  channelStatuses(): Promise<Array<{ channel: "wechat" | "feishu"; status: string | null }>>;
  pythonAvailable(): Promise<boolean>;
  countMissingSearchTokens(): Promise<{ records: number; messages: number }>;
  countPendingReplyJobs(): Promise<{ pending: number; overdue: number }>;
  schedulerStatus(): { lastTickAt: Date | null };
  measureUploads(): Promise<{ files: number; bytes: number; capped: boolean }>;
  diskSpace(): Promise<{ freeBytes: number; totalBytes: number }>;
}

export interface RunDiagnoseOptions {
  locale: Locale;
  deps: DiagnoseDeps;
  /** Overridden by the tests so a timeout does not cost ten seconds. */
  timeoutMs?: number;
}

export interface DiagnoseResult {
  items: DiagnoseItem[];
}

/** An item before it is written out in the reader's language. */
interface RawItem {
  id: string;
  status: DiagnoseStatus;
  detailKey: CopyKey;
  detailParams?: Record<string, string | number>;
  fixKey?: CopyKey;
  fixParams?: Record<string, string | number>;
}

/** The check took longer than it was allowed to. */
class DiagnoseTimeoutError extends Error {}

/**
 * Runs one check, and gives up on it after `timeoutMs`.
 *
 * The signal is there for the checks that can be cancelled (a model
 * request, the embedding probe). A check that cannot be cancelled is
 * simply abandoned — the deadline still makes the *answer* arrive on time,
 * and the abandoned promise has nowhere to put its result.
 */
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DiagnoseTimeoutError("The check timed out."));
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One line, no control characters, and not long enough to be a wall. */
function clean(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** A count that is safe to put in a sentence: a finite, non-negative integer. */
function count(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** A version name from a file name or a database row, stripped of anything else. */
function versionName(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9A-Za-z_.-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : null;
}

/** Bytes as a person reads them. */
function formatBytes(bytes: number): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(Math.round(scaled)) : scaled.toFixed(1);
  return `${shown} ${units[unit]}`;
}

/** The numeric part of a migration version, for "is one newer than the other". */
function versionNumber(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The words for a yes/no capability, built by copy keys rather than strings. */
function capabilityWords(
  locale: Locale,
  value: boolean,
  yes: CopyKey,
  no: CopyKey,
): string {
  return copy(locale, value ? yes : no);
}

// ─── The checks ────────────────────────────────────────────────────────────
//
// Each returns a RawItem or throws; `runDiagnose` owns the try/catch and the
// timeout, so no check has to say anything about a failure it does not
// understand.

async function databaseCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const state = await deps.pingDatabase();
  if (state === "no_database") {
    return {
      id: "database",
      status: "skipped",
      detailKey: "diagnostics.database.skipped",
      fixKey: "diagnostics.database.skippedFix",
    };
  }
  if (state === "unreachable") {
    return {
      id: "database",
      status: "fail",
      detailKey: "diagnostics.database.fail",
      fixKey: "diagnostics.database.failFix",
    };
  }
  return { id: "database", status: "ok", detailKey: "diagnostics.database.ok" };
}

async function migrationsCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const { latest, applied, reachable } = await deps.readMigrationVersions();
  const latestName = versionName(latest);
  if (!reachable) {
    return {
      id: "migrations",
      status: "skipped",
      detailKey: "diagnostics.migrations.skipped",
    };
  }
  if (!latestName) {
    return {
      id: "migrations",
      status: "skipped",
      detailKey: "diagnostics.migrations.skipped",
    };
  }
  const appliedName = versionName(applied);
  if (!appliedName) {
    return {
      id: "migrations",
      status: "fail",
      detailKey: "diagnostics.migrations.empty",
      fixKey: "diagnostics.migrations.failFix",
    };
  }
  if (appliedName === latestName) {
    return {
      id: "migrations",
      status: "ok",
      detailKey: "diagnostics.migrations.ok",
      detailParams: { version: latestName },
    };
  }
  const appliedNumber = versionNumber(appliedName);
  const latestNumber = versionNumber(latestName);
  if (appliedNumber !== null && latestNumber !== null && appliedNumber > latestNumber) {
    return {
      id: "migrations",
      status: "warn",
      detailKey: "diagnostics.migrations.warn",
      detailParams: { applied: appliedName, latest: latestName },
      fixKey: "diagnostics.migrations.warnFix",
    };
  }
  return {
    id: "migrations",
    status: "fail",
    detailKey: "diagnostics.migrations.fail",
    detailParams: { applied: appliedName, latest: latestName },
    fixKey: "diagnostics.migrations.failFix",
  };
}

async function redisCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const state = await deps.redisStatus();
  if (state === "absent") {
    return {
      id: "redis",
      status: "skipped",
      detailKey: "diagnostics.redis.skipped",
      fixKey: "diagnostics.redis.skippedFix",
    };
  }
  if (state === "unreachable") {
    return {
      id: "redis",
      status: "fail",
      detailKey: "diagnostics.redis.fail",
      fixKey: "diagnostics.redis.failFix",
    };
  }
  return { id: "redis", status: "ok", detailKey: "diagnostics.redis.ok" };
}

/** A provider name as an item id: stable, ASCII, and never a secret. */
function providerId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `provider.${slug || "model"}`;
}

async function providerCheck(
  provider: DiagnoseProviderProbe,
  signal: AbortSignal,
  locale: Locale,
): Promise<RawItem> {
  try {
    await provider.request(signal);
  } catch (error) {
    // The deadline has its own, more useful sentence; a provider that
    // answered with an error is simply "the request failed". The error
    // text itself is never quoted — a 401 body can echo the key back.
    if (signal.aborted) throw error;
    return {
      id: providerId(provider.name),
      status: "fail",
      detailKey: "diagnostics.provider.fail",
      detailParams: { provider: provider.name },
      fixKey: "diagnostics.provider.failFix",
    };
  }
  const streaming = capabilityWords(
    locale,
    provider.streaming,
    "diagnostics.provider.canStream",
    "diagnostics.provider.noStream",
  );
  const vision = capabilityWords(
    locale,
    provider.vision,
    "diagnostics.provider.canSee",
    "diagnostics.provider.noSee",
  );
  const transcription = capabilityWords(
    locale,
    provider.transcribe,
    "diagnostics.provider.canTranscribe",
    "diagnostics.provider.noTranscribe",
  );
  if (provider.streaming) {
    return {
      id: providerId(provider.name),
      status: "ok",
      detailKey: "diagnostics.provider.ok",
      detailParams: {
        provider: provider.name,
        streaming,
        vision,
        transcription,
      },
    };
  }
  return {
    id: providerId(provider.name),
    status: "warn",
    detailKey: "diagnostics.provider.warn",
    detailParams: { provider: provider.name, vision, transcription },
    fixKey: "diagnostics.provider.warnFix",
  };
}

async function ollamaCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const { status, model } = await deps.probeOllamaEmbed();
  const modelName = clean(model) || "?";
  if (status === "ready") {
    return {
      id: "ollama",
      status: "ok",
      detailKey: "diagnostics.ollama.ok",
      detailParams: { model: modelName },
    };
  }
  if (status === "no_model") {
    return {
      id: "ollama",
      status: "warn",
      detailKey: "diagnostics.ollama.noModel",
      detailParams: { model: modelName },
      fixKey: "diagnostics.ollama.noModelFix",
      fixParams: { model: modelName },
    };
  }
  return {
    id: "ollama",
    status: "warn",
    detailKey: "diagnostics.ollama.unreachable",
    fixKey: "diagnostics.ollama.unreachableFix",
    fixParams: { model: modelName },
  };
}

function engineCheck(
  id: "stt" | "tts",
  status: { engine: string; configured: boolean },
): RawItem {
  const engine = clean(status.engine) || "?";
  if (engine === "off") {
    return {
      id,
      status: "skipped",
      detailKey: id === "stt" ? "diagnostics.stt.skipped" : "diagnostics.tts.skipped",
      fixKey:
        id === "stt" ? "diagnostics.stt.skippedFix" : "diagnostics.tts.skippedFix",
    };
  }
  if (status.configured) {
    return {
      id,
      status: "ok",
      detailKey: id === "stt" ? "diagnostics.stt.ok" : "diagnostics.tts.ok",
      detailParams: { engine },
    };
  }
  return {
    id,
    status: "warn",
    detailKey: id === "stt" ? "diagnostics.stt.warn" : "diagnostics.tts.warn",
    detailParams: { engine },
    fixKey: id === "stt" ? "diagnostics.stt.warnFix" : "diagnostics.tts.warnFix",
  };
}

async function ffmpegCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const present = await deps.hasFfmpeg();
  if (present) {
    return { id: "ffmpeg", status: "ok", detailKey: "diagnostics.ffmpeg.ok" };
  }
  return {
    id: "ffmpeg",
    status: "warn",
    detailKey: "diagnostics.ffmpeg.warn",
    fixKey: "diagnostics.ffmpeg.warnFix",
  };
}

async function vapidCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const present = await deps.vapidKeysPresent();
  if (present) {
    return { id: "push.vapid", status: "ok", detailKey: "diagnostics.push.vapidOk" };
  }
  return {
    id: "push.vapid",
    status: "warn",
    detailKey: "diagnostics.push.vapidWarn",
    fixKey: "diagnostics.push.vapidWarnFix",
  };
}

async function subscriptionsCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const total = count(await deps.countPushSubscriptions());
  if (total > 0) {
    return {
      id: "push.subscriptions",
      status: "ok",
      detailKey: "diagnostics.push.subscriptionsOk",
      detailParams: { count: total },
    };
  }
  return {
    id: "push.subscriptions",
    status: "warn",
    detailKey: "diagnostics.push.subscriptionsWarn",
    fixKey: "diagnostics.push.subscriptionsWarnFix",
  };
}

function channelLabel(channel: "wechat" | "feishu", locale: Locale): string {
  return channel === "wechat"
    ? copy(locale, "diagnostics.channel.wechat")
    : copy(locale, "diagnostics.channel.feishu");
}

function channelItem(
  channel: "wechat" | "feishu",
  status: string | null,
  locale: Locale,
): RawItem {
  const label = channelLabel(channel, locale);
  const id = `channel.${channel}`;
  if (status === "connected" || status === "logged_in") {
    return {
      id,
      status: "ok",
      detailKey: "diagnostics.channel.ok",
      detailParams: { channel: label },
    };
  }
  if (status === "error") {
    return {
      id,
      status: "fail",
      detailKey: "diagnostics.channel.fail",
      detailParams: { channel: label },
      fixKey: "diagnostics.channel.failFix",
      fixParams: { channel: label },
    };
  }
  if (status === "configured") {
    return {
      id,
      status: "warn",
      detailKey: "diagnostics.channel.warn",
      detailParams: { channel: label },
      fixKey: "diagnostics.channel.warnFix",
      fixParams: { channel: label },
    };
  }
  if (status) {
    // Anything else — stopped, scanning, scaned, need_verifycode — is a
    // channel that is not connected right now. If it was configured and
    // then stopped, "not connected" is the honest sentence; if it is part
    // way through a login, "not connected" is still the honest sentence.
    if (status === "stopped") {
      return {
        id,
        status: "skipped",
        detailKey: "diagnostics.channel.off",
        detailParams: { channel: label },
      };
    }
    return {
      id,
      status: "warn",
      detailKey: "diagnostics.channel.warn",
      detailParams: { channel: label },
      fixKey: "diagnostics.channel.warnFix",
      fixParams: { channel: label },
    };
  }
  return {
    id,
    status: "skipped",
    detailKey: "diagnostics.channel.skipped",
    detailParams: { channel: label },
  };
}

async function pythonCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const present = await deps.pythonAvailable();
  if (present) {
    return { id: "python", status: "ok", detailKey: "diagnostics.python.ok" };
  }
  return {
    id: "python",
    status: "warn",
    detailKey: "diagnostics.python.warn",
    fixKey: "diagnostics.python.warnFix",
  };
}

async function backfillCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const { records, messages } = await deps.countMissingSearchTokens();
  const missingRecords = count(records);
  const missingMessages = count(messages);
  if (missingRecords === 0 && missingMessages === 0) {
    return { id: "backfill", status: "ok", detailKey: "diagnostics.backfill.ok" };
  }
  return {
    id: "backfill",
    status: "warn",
    detailKey: "diagnostics.backfill.warn",
    detailParams: { records: missingRecords, messages: missingMessages },
    fixKey: "diagnostics.backfill.warnFix",
  };
}

async function replyJobsCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const { pending, overdue } = await deps.countPendingReplyJobs();
  const waiting = count(pending);
  const late = count(overdue);
  if (waiting === 0) {
    return { id: "replyJobs", status: "ok", detailKey: "diagnostics.replyJobs.ok" };
  }
  if (late === 0) {
    return {
      id: "replyJobs",
      status: "ok",
      detailKey: "diagnostics.replyJobs.pendingOk",
      detailParams: { pending: waiting },
    };
  }
  return {
    id: "replyJobs",
    status: "warn",
    detailKey: "diagnostics.replyJobs.warn",
    detailParams: { pending: waiting, overdue: late },
    fixKey: "diagnostics.replyJobs.warnFix",
  };
}

function schedulerCheck(deps: DiagnoseDeps): RawItem {
  const { lastTickAt } = deps.schedulerStatus();
  if (!lastTickAt) {
    return {
      id: "scheduler",
      status: "skipped",
      detailKey: "diagnostics.scheduler.skipped",
      fixKey: "diagnostics.scheduler.skippedFix",
    };
  }
  const elapsedMs = Math.max(0, deps.now().getTime() - lastTickAt.getTime());
  if (elapsedMs >= SCHEDULER_STALE_MS) {
    return {
      id: "scheduler",
      status: "warn",
      detailKey: "diagnostics.scheduler.warn",
      detailParams: { minutes: Math.floor(elapsedMs / 60_000) },
      fixKey: "diagnostics.scheduler.warnFix",
    };
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return {
      id: "scheduler",
      status: "ok",
      detailKey: "diagnostics.scheduler.justNow",
    };
  }
  return {
    id: "scheduler",
    status: "ok",
    detailKey: "diagnostics.scheduler.ok",
    detailParams: { minutes },
  };
}

async function uploadsCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const size = await deps.measureUploads();
  if (size.capped) {
    return {
      id: "storage.uploads",
      status: "warn",
      detailKey: "diagnostics.storage.uploadsCapped",
      fixKey: "diagnostics.storage.uploadsCappedFix",
    };
  }
  return {
    id: "storage.uploads",
    status: "ok",
    detailKey: "diagnostics.storage.uploadsOk",
    detailParams: { files: count(size.files), size: formatBytes(size.bytes) },
  };
}

async function databaseSizeCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const bytes = await deps.databaseSizeBytes();
  if (bytes === null) {
    return {
      id: "storage.database",
      status: "skipped",
      detailKey: "diagnostics.storage.dbSkipped",
    };
  }
  return {
    id: "storage.database",
    status: "ok",
    detailKey: "diagnostics.storage.dbOk",
    detailParams: { size: formatBytes(bytes) },
  };
}

async function diskCheck(deps: DiagnoseDeps): Promise<RawItem> {
  const { freeBytes, totalBytes } = await deps.diskSpace();
  const free = Number.isFinite(freeBytes) && freeBytes > 0 ? freeBytes : 0;
  const total = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
  const low = free < LOW_DISK_BYTES || (total > 0 && free / total < 0.05);
  if (low) {
    return {
      id: "storage.disk",
      status: "warn",
      detailKey: "diagnostics.storage.diskWarn",
      detailParams: { free: formatBytes(free) },
      fixKey: "diagnostics.storage.diskWarnFix",
    };
  }
  return {
    id: "storage.disk",
    status: "ok",
    detailKey: "diagnostics.storage.diskOk",
    detailParams: { free: formatBytes(free), total: formatBytes(total) },
  };
}

// ─── Running them all ──────────────────────────────────────────────────────

function timeoutItem(id: string, timeoutMs: number): RawItem {
  return {
    id,
    status: "fail",
    detailKey: "diagnostics.timeout",
    detailParams: { seconds: Math.max(1, Math.round(timeoutMs / 1000)) },
    fixKey: "diagnostics.timeoutFix",
  };
}

function errorItem(id: string): RawItem {
  return {
    id,
    status: "fail",
    detailKey: "diagnostics.error",
    fixKey: "diagnostics.errorFix",
  };
}

/**
 * Runs one check, and always answers with an item.
 *
 * The failure of one check is not the failure of the others: a thrown
 * dependency becomes a `fail` for *that* item, and the next check still
 * runs. The thrown error itself is never quoted into the item — an error
 * message from a client library is exactly the kind of thing that carries
 * a URL with a password in it.
 */
async function safeCheck(
  id: string,
  run: (signal: AbortSignal) => Promise<RawItem>,
  timeoutMs: number,
): Promise<RawItem> {
  try {
    return await withTimeout(run, timeoutMs);
  } catch (error) {
    if (error instanceof DiagnoseTimeoutError) return timeoutItem(id, timeoutMs);
    console.warn(
      `[Diagnose] The "${id}" check failed:`,
      error instanceof Error ? error.message : error,
    );
    return errorItem(id);
  }
}

/** Writes a raw item out in the reader's language, from a whitelist of fields. */
function localize(raw: RawItem, locale: Locale): DiagnoseItem {
  const item: DiagnoseItem = {
    id: raw.id,
    status: raw.status,
    detail: clean(copy(locale, raw.detailKey, cleanParams(raw.detailParams))),
  };
  if (raw.fixKey) {
    item.fix = clean(copy(locale, raw.fixKey, cleanParams(raw.fixParams)));
  }
  return item;
}

/** Placeholder values, made single-line and bounded before interpolation. */
function cleanParams(
  params: Record<string, string | number> | undefined,
): Record<string, string | number> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === "number" ? value : clean(value);
  }
  return out;
}

/**
 * Runs every check and returns the results, problems first.
 *
 * The checks run one after another in a fixed order. Several of them make
 * a request to something real — a model, Ollama, a channel — and firing
 * them all at once would mean the diagnosis is a small load spike on the
 * user's own services. Sequential also keeps the report's order stable.
 */
export async function runDiagnose(options: RunDiagnoseOptions): Promise<DiagnoseResult> {
  const { locale, deps } = options;
  const timeoutMs = options.timeoutMs ?? DIAGNOSE_CHECK_TIMEOUT_MS;
  const raw: RawItem[] = [];
  const check = async (
    id: string,
    run: (signal: AbortSignal) => Promise<RawItem>,
  ) => {
    raw.push(await safeCheck(id, run, timeoutMs));
  };

  await check("database", () => databaseCheck(deps));
  await check("migrations", () => migrationsCheck(deps));
  await check("redis", () => redisCheck(deps));

  // The models, one item each. The list itself is a dependency call (the
  // user's own configurations, or the operator's), and it can fail on its
  // own.
  let providers: DiagnoseProviderProbe[] | null = null;
  try {
    providers = await withTimeout(() => deps.listProviders(), timeoutMs);
  } catch (error) {
    if (error instanceof DiagnoseTimeoutError) {
      raw.push(timeoutItem("providers", timeoutMs));
    } else {
      console.warn(
        "[Diagnose] The provider list could not be read:",
        error instanceof Error ? error.message : error,
      );
      raw.push(errorItem("providers"));
    }
  }
  if (providers !== null) {
    if (providers.length === 0) {
      raw.push({
        id: "providers",
        status: "skipped",
        detailKey: "diagnostics.providers.skipped",
        fixKey: "diagnostics.providers.skippedFix",
      });
    } else {
      const usedIds = new Set<string>();
      for (const provider of providers) {
        const base = providerId(provider.name);
        let id = base;
        let suffix = 2;
        while (usedIds.has(id)) {
          id = `${base}.${suffix}`;
          suffix += 1;
        }
        usedIds.add(id);
        const providerItemResult = await safeCheck(
          id,
          (signal) => providerCheck(provider, signal, locale),
          timeoutMs,
        );
        // The check builds the item from the provider's name; the id is
        // this loop's, so two rows for the same provider stay apart.
        providerItemResult.id = id;
        raw.push(providerItemResult);
      }
    }
  }

  await check("ollama", () => ollamaCheck(deps));
  await check("stt", async () => engineCheck("stt", deps.sttStatus()));
  await check("tts", async () => engineCheck("tts", deps.ttsStatus()));
  await check("ffmpeg", () => ffmpegCheck(deps));

  await check("push.vapid", () => vapidCheck(deps));
  await check("push.subscriptions", () => subscriptionsCheck(deps));

  let channels: Awaited<ReturnType<DiagnoseDeps["channelStatuses"]>> | null = null;
  try {
    channels = await withTimeout(() => deps.channelStatuses(), timeoutMs);
  } catch (error) {
    if (error instanceof DiagnoseTimeoutError) {
      raw.push(timeoutItem("channels", timeoutMs));
    } else {
      console.warn(
        "[Diagnose] The channel states could not be read:",
        error instanceof Error ? error.message : error,
      );
      raw.push(errorItem("channels"));
    }
  }
  if (channels !== null) {
    if (channels.length === 0) {
      // Nothing to read is not a problem with a channel; both are simply
      // not configured.
      raw.push(channelItem("wechat", null, locale));
      raw.push(channelItem("feishu", null, locale));
    } else {
      for (const state of channels) {
        raw.push(channelItem(state.channel, state.status, locale));
      }
    }
  }

  await check("python", () => pythonCheck(deps));
  await check("backfill", () => backfillCheck(deps));
  await check("replyJobs", () => replyJobsCheck(deps));
  await check("scheduler", async () => schedulerCheck(deps));

  await check("storage.uploads", () => uploadsCheck(deps));
  await check("storage.database", () => databaseSizeCheck(deps));
  await check("storage.disk", () => diskCheck(deps));

  return { items: sortDiagnoseItems(raw.map((item) => localize(item, locale))) };
}
