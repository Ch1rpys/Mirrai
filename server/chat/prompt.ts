/**
 * The prompt a persona is given.
 *
 * There has to be exactly one way to build it. The conversation builds
 * it in one place and the "what does the system think" query built it
 * in another — so the prompt a user inspected was not the prompt the
 * model was working from.
 */
import type { Persona } from "../../drizzle/schema";
import * as db from "../db";
import { buildSystemPrompt } from "../_core/persona-utils";
import { retrieveMemories, formatMemoriesForPrompt, formatAnchorsForPrompt } from "./retrieval";
import { buildUserContextBlock, buildRelationshipSection, resolveRelationshipPhase, isUserMood } from "@shared/user-side";
import { copy } from "@shared/copy";
import type { MicroRule } from "@shared/micro-rules";
import type { ImperfectionEntry } from "@shared/imperfection";
import type { Suppression } from "@shared/suppressions";
import type { SpeechAct } from "@shared/speech-acts";
import { retrieveExemplars, renderExemplars } from "./exemplars";

/**
 * The user's own time zone, for the parts of the prompt that are about
 * the user's days.
 *
 * It is the *user's* zone, and only the user's.
 *
 * It used to prefer the persona's — and the persona's zone is "where
 * this persona lives", which is a different thing entirely. So the
 * prompt said "they are in the Asia/Shanghai time zone" and filled it
 * with the persona's zone; and the relative dates, and the rule that a
 * trigger stops being a trigger after three days, were measured on the
 * *persona's* calendar whenever the persona had a zone.
 *
 * A failure to read it is not worth failing a whole prompt over — the
 * dates fall back to the server's own clock, which is what they did
 * before.
 */
/**
 * A database read that must not take the prompt down with it.
 *
 * Tests mock a slice of `../db`. A missing export is not a missing
 * person — the prompt still has to be built.
 */
async function optionalCall<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

export async function userTimeZone(_persona: unknown, userId: number): Promise<string | null> {
  try {
    return (await db.getUserTimezone(userId)) ?? null;
  } catch {
    return null;
  }
}

export interface PromptContext {
  persona: Persona;
  userId: number;
  userMessage?: string;
  locale?: "zh" | "en";
  now?: Date;
  /** The scene overlay, when a scene is active. */
  sceneOverlay?: string | null;
  /**
   * The state the prompt is describing.
   *
   * It is not always the persona's stored state: a scene can set the
   * mood the persona speaks in. The imperfection follows whatever mood
   * the prompt *states* — a prompt that says "you are distant" and then
   * applies the deviations of "happy" is telling the model two different
   * things at once.
   */
  emotionalState?: string | null;
  emotionalDesc?: string;
  /** A summary the caller already computed. */
  summarySection?: string;
  /** Memories the caller already retrieved. */
  memories?: Parameters<typeof formatAnchorsForPrompt>[0];
  /**
   * Whether the retrieved memories are marked as recalled.
   *
   * A read — looking at the prompt — is not a conversation. Marking the
   * memories as recalled halves their weight for a day, so a preview
   * used to take the user's own pinned memories and anchors down to
   * half their weight every time they opened it.
   */
  markRecalled?: boolean;
  /** The message the user is replying to. */
  quotedSection?: string | null;
  /**
   * The rules the persona discriminates by.
   *
   * `null` turns them off for this prompt without touching the persona.
   * The evaluation harness needs that: the same persona, measured with
   * and without its rules, against the same held-out lines.
   */
  microRules?: MicroRule[] | null;
  /**
   * The per-state imperfection.
   *
   * `null` turns it off, the same way the rules do.
   */
  imperfectionProfile?: ImperfectionEntry[] | null;
  suppressions?: Suppression[] | null;
  sampledAct?: SpeechAct | null;
  /**
   * Held-out reply ids/texts that must not appear as exemplars.
   */
  excludeExemplarIds?: number[];
  excludeExemplarTexts?: string[];
  periodId?: string | null;
  skipExemplars?: boolean;
}

/**
 * Assembles the full system prompt.
 */
export async function buildPromptForPersona(
  context: PromptContext,
): Promise<string> {
  const { persona, userId } = context;
  const locale = context.locale ?? "zh";
  const now = context.now ?? new Date();

  const memories = context.memories ?? await retrieveMemories({
    personaId: persona.id,
    userId,
    userMessage: context.userMessage ?? "",
    /**
     * Whether the memories are marked as recalled.
     *
     * Looking at the prompt is a read, not a conversation. It used to
     * mark the memories as recalled — and a memory that has just been
     * recalled has its weight halved for a day — so the user's own
     * pinned memories and anchors lost half their weight every time
     * they opened the prompt.
     */
    markRecalled: context.markRecalled,
  }).catch(() => []);
  const anchors = memories.filter((m) => m.category === "anchor");
  const ordinary = memories.filter((m) => m.category !== "anchor");

  const summary = context.summarySection !== undefined
    ? null
    : await db.getLatestChatSummary(persona.id, userId).catch(() => null);
  const user = await db.getUserById(userId).catch(() => null);
  const recentMood = await db.getRecentUserMood(userId).catch(() => null);
  const events = await db.getRelationshipEvents(persona.id, userId, 20).catch(() => []);
  const phase = resolveRelationshipPhase(events as any);

  const userContext = buildUserContextBlock(
    {
      name: user?.name,
      addressStyle: user?.addressStyle,
      boundaries: user?.boundaries,
      timezone: user?.timezone,
    },
    {
      locale,
      mood: isUserMood(recentMood?.mood) ? recentMood.mood : null,
    },
  );

  return buildSystemPrompt(persona, {
    sceneOverlay: context.sceneOverlay ?? null,
    emotionalDesc: context.emotionalDesc,
    emotionalState: context.emotionalState ?? null,
    anchorSection: formatAnchorsForPrompt(anchors, locale),
    memorySection: formatMemoriesForPrompt(ordinary, locale),
    summarySection:
      context.summarySection ??
      (summary?.summary ? `${copy(locale, "prompt.summarySectionHeading")}\n${summary.summary}` : ""),
    realismLevel: (persona.personaData as any)?.realismLevel,
    timeZone: (persona as any).timezone ?? (await db.getUserTimezone(userId)),
    userContext,
    quotedSection: context.quotedSection ?? null,
    /**
     * The turn's own time.
     *
     * The section is given the time the turn happened at — so the
     * relative dates it writes ("three days ago") and the rule that a
     * trigger stops being a trigger after three days are measured
     * against the same clock as everything else in the prompt.
     *
     * It was given the wall clock instead, so the two could disagree:
     * a prompt built for a turn that happened at 23:59 said a trigger
     * from four days ago was two days old.
     */
    relationshipEvents: buildRelationshipSection(
      events as any,
      phase,
      locale,
      now,
      // The user's own clock — so "today" is the user's today.
      await userTimeZone(persona, userId),
    ),
    relationshipPhase: phase,
    reachability: (persona as any).reachability ?? "reachable",
    microRules: applyPeriod(persona, context.periodId, "microRules", context.microRules),
    imperfectionProfile: context.imperfectionProfile,
    suppressions: applyPeriod(
      persona,
      context.periodId,
      "suppressions",
      context.suppressions,
    ),
    sampledAct: context.sampledAct ?? null,
    exemplarSection: context.skipExemplars
      ? ""
      : await exemplarSectionFor(context, locale),
    memoryConflictSection: memoryConflictSectionFor(
      await optionalCall(() => db.getMemoriesByPersonaId(persona.id, userId), []),
      locale,
    ),
    locale,
    now,
    periodId: context.periodId ?? null,
  });
}

function applyPeriod<T>(
  persona: Persona,
  periodId: string | null | undefined,
  field: "microRules" | "suppressions",
  override: T | null | undefined,
): T | null | undefined {
  if (override === null) return null;
  if (override !== undefined) return override;
  if (!periodId) return undefined;
  const period = periodOf(persona, periodId);
  if (field === "suppressions" && period?.suppressionsDelta) {
    return period.suppressionsDelta as T;
  }
  return undefined;
}

export function periodOf(
  persona: Persona,
  periodId: string | null | undefined,
): { id?: string; from?: string; to?: string; suppressionsDelta?: unknown; actProfileDelta?: unknown } | undefined {
  if (!periodId) return undefined;
  const periods = ((persona.personaData as any)?.periods ?? []) as Array<{
    id?: string;
    from?: string;
    to?: string;
    suppressionsDelta?: unknown;
    actProfileDelta?: unknown;
  }>;
  return periods.find((item) => item.id === periodId);
}

export function actProfileForTurn(
  persona: Persona,
  periodId: string | null | undefined,
) {
  const period = periodOf(persona, periodId);
  if (period?.actProfileDelta) return period.actProfileDelta;
  return (persona.personaData as any)?.actProfile ?? null;
}

async function exemplarSectionFor(
  context: PromptContext,
  locale: "zh" | "en",
): Promise<string> {
  if (!context.userMessage) return "";
  const records = await optionalCall(
    () => db.getCollectedMessagesForPersona(context.persona.id, context.userId, { newest: true }),
    [],
  );
  const period = periodOf(context.persona, context.periodId);
  const from = period?.from ? new Date(period.from) : null;
  const to = period?.to ? new Date(period.to) : null;
  const scoped = from && to
    ? (records as Array<{ timestamp?: Date | string | null }>).filter((row) => {
        if (!row.timestamp) return false;
        const at = new Date(row.timestamp).getTime();
        return at >= from.getTime() && at <= to.getTime();
      })
    : records;
  const found = retrieveExemplars({
    userMessage: context.userMessage,
    records: scoped as any,
    excludeIds: context.excludeExemplarIds,
    excludeTexts: context.excludeExemplarTexts,
    personaData: context.persona.personaData as any,
  });
  return renderExemplars(found, locale);
}

function memoryConflictSectionFor(
  memories: Array<{ factKey?: string | null; status?: string | null; title: string; description?: string | null }>,
  locale: "zh" | "en",
): string {
  const groups = new Map<string, typeof memories>();
  for (const memory of memories) {
    if (!memory.factKey || memory.status === "superseded") continue;
    const list = groups.get(memory.factKey) ?? [];
    list.push(memory);
    groups.set(memory.factKey, list);
  }
  const conflicts = [...groups.values()].filter((list) => list.length > 1);
  if (!conflicts.length) return "";
  const lines = conflicts.flatMap((list) =>
    list.map((memory) => `- ${memory.title}${memory.description ? `：${memory.description}` : ""}`),
  );
  return [copy(locale, "prompt.memoryConflict"), ...lines].join("\n");
}
