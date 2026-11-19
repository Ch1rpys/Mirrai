/**
 * A reply that will be written later.
 *
 * The row is the moment they look at their phone. When it comes due,
 * the turn answers every user message that is still waiting. Two
 * processes cannot run the same job: claiming is the same compare-and-
 * set used for letters.
 */
import type { Persona } from "../../drizzle/schema";
import type { ReplyJob, InsertReplyJob } from "../../drizzle/schema";
import * as db from "../db";
import { copy, type Locale } from "@shared/copy";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { effectiveStyleProfile } from "@shared/style-profile";
import { isAsleep, nextWake, normalizeRoutine } from "@shared/routine-profile";
import {
  currentRoutines,
  normalizeLifeEvents,
  type LifeEvent,
  type RoutineSchedule,
} from "@shared/life-events";
import { parseZoneless, zonedDateKey } from "@shared/timezone";
import { getEffectivePresence } from "../_core/graduation";
import { pushToUser } from "../_core/push";
import { getChannelAdapter } from "../channels";
import {
  currentGeneration,
  enter,
  inboxKey,
  leave,
} from "./inbox";

export const IN_CONNECTION_DELAY_MS = 90_000;
export const REPLY_JOB_MAX_ATTEMPTS = 3;
export const REPLY_JOB_RETRY_MS = 2 * 60_000;
const IN_PROCESS_HORIZON_MS = 24 * 60 * 60 * 1000;

export type ReplyReason = "delay" | "asleep" | "busy";

export interface DeferDecision {
  jobId: number;
  dueAt: Date;
  reason: ReplyReason;
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();

function nextDateKey(key: string): string {
  const [year, month, day] = key.split("-").map((part) => Number(part));
  const utc = new Date(Date.UTC(year, month - 1, day + 1));
  return utc.toISOString().slice(0, 10);
}

export function routineWindowEnd(
  now: Date,
  schedule: RoutineSchedule,
  timeZone: string,
): Date {
  const today = zonedDateKey(now, timeZone);
  if (schedule.endHour >= 24) {
    const midnight = parseZoneless(`${nextDateKey(today)} 00:00`, timeZone);
    return midnight && midnight.getTime() > now.getTime() ? midnight : now;
  }
  const hh = String(schedule.endHour).padStart(2, "0");
  const end = parseZoneless(`${today} ${hh}:00`, timeZone);
  return end && end.getTime() > now.getTime() ? end : now;
}

export function computeReplyDue(params: {
  now: Date;
  delayMs: number;
  maxDelayMinutes: number;
  sleep: boolean;
  asleep: boolean;
  wakeAt: Date | null;
  busyUntil: Date | null;
}): { dueAt: Date; reason: ReplyReason } {
  const cap = params.now.getTime() + params.maxDelayMinutes * 60_000;
  if (params.sleep && params.asleep && params.wakeAt) {
    return {
      dueAt: new Date(params.wakeAt.getTime() + params.delayMs),
      reason: "asleep",
    };
  }
  if (params.busyUntil) {
    const uncapped = params.busyUntil.getTime() + params.delayMs;
    return {
      dueAt: new Date(Math.min(uncapped, cap)),
      reason: "busy",
    };
  }
  return {
    dueAt: new Date(Math.min(params.now.getTime() + params.delayMs, cap)),
    reason: "delay",
  };
}

function busyContext(
  persona: Persona,
  now: Date,
  timeZone: string,
): { until: Date; title: string } | null {
  const events = normalizeLifeEvents(
    (persona.personaData as { lifeEvents?: unknown } | null)?.lifeEvents,
  );
  const current = currentRoutines(events, now, timeZone);
  if (current.length === 0) return null;
  let until = now;
  let title = current[0]!.title;
  for (const event of current) {
    if (!event.schedule) continue;
    const end = routineWindowEnd(now, event.schedule, timeZone);
    if (end.getTime() >= until.getTime()) {
      until = end;
      title = event.title;
    }
  }
  return until.getTime() > now.getTime() ? { until, title } : null;
}

export async function maybeDeferReply(params: {
  persona: Persona;
  userId: number;
  batch: string[];
  now: Date;
  delayMs: number;
  channel?: string;
  targetId?: string;
  locale: Locale;
  periodId?: string | null;
}): Promise<DeferDecision | "in-connection" | null> {
  const settings = normalizePersonaSettings(params.persona.settings);
  if (!settings.timing.asyncDelivery) return null;

  const existing = await db.getPendingReplyJob(params.persona.id, params.userId, "reply");
  if (existing) {
    return {
      jobId: existing.id,
      dueAt: existing.dueAt,
      reason: (existing.reason as ReplyReason) || "delay",
    };
  }

  const zone = (params.persona as { timezone?: string | null }).timezone || "UTC";
  const routine = normalizeRoutine(effectiveStyleProfile(params.persona).routine);
  const asleep = Boolean(
    settings.timing.sleep
    && routine
    && isAsleep(params.now, routine, zone),
  );
  const busy = busyContext(params.persona, params.now, zone);
  const due = computeReplyDue({
    now: params.now,
    delayMs: params.delayMs,
    maxDelayMinutes: settings.timing.maxDelayMinutes,
    sleep: settings.timing.sleep,
    asleep,
    wakeAt: asleep && routine ? nextWake(params.now, routine, zone) : null,
    busyUntil: busy?.until ?? null,
  });
  if (due.dueAt.getTime() - params.now.getTime() < IN_CONNECTION_DELAY_MS) {
    return "in-connection";
  }

  const row = await db.createReplyJob({
    userId: params.userId,
    personaId: params.persona.id,
    kind: "reply",
    status: "pending",
    reason: due.reason,
    dueAt: due.dueAt,
    channel: params.channel || "web",
    targetId: params.targetId || null,
    locale: params.locale,
    periodId: params.periodId ?? null,
    attempts: 0,
    payload: due.reason === "busy" && busy ? { title: busy.title } : {},
  } as InsertReplyJob);
  scheduleReplyJob(row);
  return { jobId: row.id, dueAt: row.dueAt, reason: (row.reason as ReplyReason) || due.reason };
}

export function scheduleReplyJob(job: { id: number; dueAt: Date; userId?: number }): void {
  const wait = job.dueAt.getTime() - Date.now();
  if (wait > IN_PROCESS_HORIZON_MS) return;
  const existing = timers.get(job.id);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, wait);
  const timer = setTimeout(() => {
    timers.delete(job.id);
    const userId = job.userId;
    if (typeof userId !== "number") {
      void sweepReplyJobs(new Date()).catch((error) => {
        console.warn("[ReplyJobs] A scheduled job could not run:", error);
      });
      return;
    }
    void runReplyJob(job.id, userId).catch((error) => {
      console.warn("[ReplyJobs] A scheduled job could not run:", error);
    });
  }, delay);
  timer.unref?.();
  timers.set(job.id, timer);
}

export function clearReplyJobTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

export async function sweepReplyJobs(now: Date = new Date()): Promise<number> {
  const due = await db.listDueReplyJobs(now);
  let ran = 0;
  for (const job of due) {
    const ok = await runReplyJob(job.id, job.userId);
    if (ok) ran += 1;
  }
  return ran;
}

export async function cancelPendingReplyJobs(
  personaId: number,
  userId: number,
): Promise<number> {
  const pending = await db.getPendingReplyJob(personaId, userId, "reply");
  if (pending) {
    const timer = timers.get(pending.id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(pending.id);
    }
  }
  return db.cancelPendingReplyJobs(personaId, userId);
}

async function deliverReply(
  job: ReplyJob,
  persona: Persona,
  text: string,
): Promise<void> {
  if (!text) return;
  const channel = job.channel || "web";
  if (channel === "wechat" || channel === "feishu") {
    const adapter = getChannelAdapter(channel);
    if (!adapter || !job.targetId) return;
    try {
      await adapter.send(
        job.userId,
        job.targetId,
        text,
        job.locale === "en" ? "en" : "zh",
      );
    } catch (error) {
      console.warn("[ReplyJobs] The channel could not send the reply:", error);
    }
    return;
  }
  try {
    await pushToUser(job.userId, {
      kind: "reply",
      personaId: persona.id,
      personaName: persona.name,
      text,
    });
  } catch (error) {
    console.warn("[ReplyJobs] The push could not be sent:", error);
  }
}

async function failWithNotice(job: ReplyJob): Promise<void> {
  const locale: Locale = job.locale === "en" ? "en" : "zh";
  await db.createMessage({
    personaId: job.personaId,
    userId: job.userId,
    role: "assistant",
    content: copy(locale, "chat.replyFailedNotice"),
    channel: job.channel === "wechat" || job.channel === "feishu" ? job.channel : "web",
    origin: "system-notice",
  });
  await db.finishReplyJob(job.id, job.userId, "failed");
}

export async function runReplyJob(jobId: number, userId: number): Promise<boolean> {
  const claimed = await db.claimReplyJob(jobId, userId);
  if (!claimed) return false;
  const job = await db.getReplyJobById(jobId, userId);
  if (!job) return false;

  if (job.kind !== "reply") {
    await db.finishReplyJob(jobId, userId, "cancelled");
    return false;
  }

  const persona = await db.getPersonaById(job.personaId, userId);
  const presence = persona
    ? getEffectivePresence({
      personaPresence: persona.presence,
      graduationStatus: persona.graduationStatus,
    })
    : "asleep";
  if (!persona || presence === "asleep") {
    await db.finishReplyJob(jobId, userId, "cancelled");
    return false;
  }

  const history = await db.getMessagesByPersonaId(job.personaId, userId, 200).catch(() => []);
  const lastUser = [...history].reverse().find((row) => row.role === "user");
  if (!lastUser) {
    await db.finishReplyJob(jobId, userId, "cancelled");
    return false;
  }

  const key = inboxKey(userId, persona.id);
  const controller = new AbortController();
  const generation = currentGeneration(key);
  enter(key, "generating", controller);
  let text = "";
  let superseded = false;
  let failedMessage = "";
  try {
    const { runConversation } = await import("./service");
    for await (const event of runConversation({
      persona,
      userId,
      message: lastUser.content,
      alreadyPersisted: true,
      admitted: true,
      storedUserMessageId: lastUser.id,
      mode: "once",
      now: new Date(),
      locale: job.locale === "en" ? "en" : "zh",
      channel: job.channel === "wechat" || job.channel === "feishu" ? job.channel : "web",
      periodId: job.periodId,
      conversationKey: job.targetId ?? undefined,
      signal: controller.signal,
      inbox: { key, generation },
      fromReplyJob: { jobId: job.id, reason: (job.reason as ReplyReason) || "delay" },
    })) {
      if (event.type === "delta") text += event.text;
      else if (event.type === "burst") text = event.texts.join("\n\n");
      else if (event.type === "silence") text = event.notice;
      else if (event.type === "superseded") superseded = true;
      else if (event.type === "error") failedMessage = event.message || "the model did not answer";
    }
    if (failedMessage) throw new Error(failedMessage);
    const still = await db.getReplyJobById(jobId, userId);
    if (still?.status !== "running") return false;
    if (superseded) {
      const dueAt = new Date();
      await db.retryReplyJob(jobId, userId, dueAt, job.attempts ?? 0);
      scheduleReplyJob({ id: jobId, dueAt, userId });
      return false;
    }
    await deliverReply(job, persona, text);
    await db.finishReplyJob(jobId, userId, "done");
    return true;
  } catch (error) {
    const attempts = (job.attempts ?? 0) + 1;
    if (attempts >= REPLY_JOB_MAX_ATTEMPTS) {
      await failWithNotice(job);
      return false;
    }
    const dueAt = new Date(Date.now() + REPLY_JOB_RETRY_MS);
    await db.retryReplyJob(jobId, userId, dueAt, attempts);
    scheduleReplyJob({ id: jobId, dueAt, userId });
    console.warn("[ReplyJobs] A reply job failed and will be tried again:", error);
    return false;
  } finally {
    leave(key, generation);
  }
}

export async function replyNow(personaId: number, userId: number): Promise<boolean> {
  const pending = await db.getPendingReplyJob(personaId, userId, "reply");
  if (!pending) return false;
  const timer = timers.get(pending.id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(pending.id);
  }
  return runReplyJob(pending.id, userId);
}

/** @internal for tests */
export function pendingReplyTimers(): Map<number, ReturnType<typeof setTimeout>> {
  return timers;
}

export type { LifeEvent };
