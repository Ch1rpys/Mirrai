/**
 * "Are we ready for a local adapter or a shallow fusion?" (B9.1 / B9.2)
 *
 * The two heavy approaches were locked in v5 behind conditions, and the
 * lock is not being lifted here. What this file adds is the answer to
 * "have the conditions been met yet?", as numbers rather than a feeling:
 * four conditions, each with the evidence behind it, and a final verdict.
 *
 * It reads. It does not train anything, and it does not call a model —
 * even when the verdict is `true`, the answer is written into the progress
 * file for the user to decide.
 */
import type { BlindSession, Persona } from "../../drizzle/schema";
import { copy, type CopyKey, type Locale } from "@shared/copy";
import { layersFromSettings, type LayerId } from "@shared/layers";
import { normalizeStyleProfile } from "@shared/style-profile";

/** The cheap layers the v5 unlock condition names, plus rerank. */
const CHEAP_LAYERS: LayerId[] = ["rules", "suppressions", "exemplars", "act"];

/**
 * "Their replies are at least about a thousand lines" — the same order of
 * magnitude the v5 unlock text uses, as one number.
 */
export const UNLOCK_TA_LINES = 1000;

/** "The blind-test hit rate is still below 50%." */
export const UNLOCK_BLIND_HIT_MAX = 0.5;

/** "The reasons are about wording" — a majority of the stated reasons. */
export const UNLOCK_WORD_REASON_SHARE = 0.5;

export type UnlockConditionKey = "cheapLayers" | "blindHitRate" | "blindReasons" | "taTextLines";

export interface UnlockCondition {
  key: UnlockConditionKey;
  /** The condition is met. `null` means there is no data to judge by. */
  satisfied: boolean | null;
  /** The numbers the verdict is based on, for the line and for tests. */
  data: Record<string, unknown>;
}

export type TellCategory =
  | "wording"
  | "length"
  | "ending"
  | "particle"
  | "laugh"
  | "emoji"
  | "punctuation"
  | "layout"
  | "surprise";

const TELL_CATEGORY_KEYS: Record<TellCategory, CopyKey> = {
  wording: "unlock.category.wording",
  length: "unlock.category.length",
  ending: "unlock.category.ending",
  particle: "unlock.category.particle",
  laugh: "unlock.category.laugh",
  emoji: "unlock.category.emoji",
  punctuation: "unlock.category.punctuation",
  layout: "unlock.category.layout",
  surprise: "unlock.category.surprise",
};

/** Which family a discriminator feature belongs to. */
export function tellCategory(feature: string): TellCategory {
  if (feature.startsWith("ending.")) return "ending";
  switch (feature) {
    case "chars":
      return "length";
    case "particle":
      return "particle";
    case "haRun":
      return "laugh";
    case "emoji":
      return "emoji";
    case "question":
    case "exclaim":
      return "punctuation";
    case "newline":
    case "list":
      return "layout";
    case "surprise":
      return "surprise";
    default:
      // Everything else the discriminator reports is a character n-gram:
      // a word or a habit of writing one.
      return "wording";
  }
}

export interface UnlockReference {
  auc: number | null;
  tells: Array<{ feature: string; weight: number; category: TellCategory }>;
}

export interface UnlockCheckReport {
  conditions: UnlockCondition[];
  reference: UnlockReference;
  unlocked: boolean;
}

export interface UnlockCheckInput {
  persona: Pick<Persona, "settings" | "rerankEnabled" | "styleProfile">;
  /** Every blind sitting of this persona, as `listBlindSessions` returns it. */
  sessions: Array<Pick<BlindSession, "subject" | "summary">>;
  /** Their private text lines. */
  taTextLines: number;
}

interface SittingSummary {
  n: number;
  pickedPersona: number;
  reasons: Record<string, number>;
}

function readSummary(value: unknown): SittingSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const n = Number(row.n);
  if (!Number.isFinite(n) || n <= 0) return null;
  const picked = Number(row.pickedPersona);
  const reasons: Record<string, number> = {};
  const raw = row.reasons;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, count] of Object.entries(raw as Record<string, unknown>)) {
      const number = Number(count);
      if (Number.isFinite(number) && number > 0) reasons[key] = number;
    }
  }
  return {
    n,
    pickedPersona: Number.isFinite(picked) ? Math.max(0, Math.min(1, picked)) : 0,
    reasons,
  };
}

/**
 * The sittings someone other than the owner took.
 *
 * A sitting the owner did themselves does not measure whether the persona
 * can fool anyone — they remember their own lines. Only guest sittings
 * count.
 */
export function guestSittings(
  sessions: Array<Pick<BlindSession, "subject" | "summary">>,
): SittingSummary[] {
  const out: SittingSummary[] = [];
  for (const session of sessions) {
    if (session.subject !== "friend") continue;
    const summary = readSummary(session.summary);
    if (summary) out.push(summary);
  }
  return out;
}

function discriminatorReference(persona: UnlockCheckInput["persona"]): UnlockReference {
  const profile = normalizeStyleProfile(persona.styleProfile);
  const raw = profile.discriminator;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { auc: null, tells: [] };
  const row = raw as Record<string, unknown>;
  if (row.insufficient === true) return { auc: null, tells: [] };
  const auc = Number(row.auc);
  const tells: UnlockReference["tells"] = [];
  if (Array.isArray(row.tells)) {
    for (const item of row.tells) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const tell = item as Record<string, unknown>;
      const feature = typeof tell.feature === "string" ? tell.feature : "";
      const weight = Number(tell.weight);
      if (!feature || !Number.isFinite(weight)) continue;
      tells.push({ feature, weight, category: tellCategory(feature) });
    }
  }
  tells.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return {
    auc: Number.isFinite(auc) ? auc : null,
    tells: tells.slice(0, 5),
  };
}

/**
 * Reads the four conditions off what is already stored.
 *
 * Every answer is either met, not met, or "no data" — and no data is not
 * a pass.
 */
export function evaluateUnlockCheck(input: UnlockCheckInput): UnlockCheckReport {
  const layers = layersFromSettings(input.persona);
  const cheap: UnlockCondition = {
    key: "cheapLayers",
    satisfied: CHEAP_LAYERS.every((id) => layers[id]) && Boolean(input.persona.rerankEnabled),
    data: {
      rules: layers.rules,
      suppressions: layers.suppressions,
      exemplars: layers.exemplars,
      act: layers.act,
      rerank: Boolean(input.persona.rerankEnabled),
    },
  };

  const sittings = guestSittings(input.sessions);
  const totalAnswers = sittings.reduce((sum, row) => sum + row.n, 0);
  const pickedPersona = sittings.reduce((sum, row) => sum + row.pickedPersona * row.n, 0);
  const hitRate = totalAnswers > 0 ? pickedPersona / totalAnswers : null;
  const blindHitRate: UnlockCondition = {
    key: "blindHitRate",
    satisfied: hitRate == null ? null : hitRate < UNLOCK_BLIND_HIT_MAX,
    data: {
      sittings: sittings.length,
      answers: totalAnswers,
      pickedPersona: hitRate,
      threshold: UNLOCK_BLIND_HIT_MAX,
    },
  };

  const reasons: Record<string, number> = {};
  for (const sitting of sittings) {
    for (const [key, count] of Object.entries(sitting.reasons)) {
      reasons[key] = (reasons[key] ?? 0) + count;
    }
  }
  const reasonTotal = Object.values(reasons).reduce((sum, count) => sum + count, 0);
  const word = reasons.word ?? 0;
  const act = reasons.act ?? 0;
  const blindReasons: UnlockCondition = {
    key: "blindReasons",
    /**
     * "The reasons are about wording, not about the wrong action."
     *
     * Both halves have to hold: a majority of the stated reasons, and more
     * of them about the words than about the action. One alone can pass by
     * accident — "wording beats action" when the other reason is `mood`,
     * or a majority share of three answers.
     */
    satisfied:
      reasonTotal === 0
        ? null
        : word / reasonTotal > UNLOCK_WORD_REASON_SHARE && word > act,
    data: {
      word,
      act,
      total: reasonTotal,
      wordShare: reasonTotal > 0 ? word / reasonTotal : null,
      reasons,
    },
  };

  const taTextLines: UnlockCondition = {
    key: "taTextLines",
    satisfied: input.taTextLines >= UNLOCK_TA_LINES,
    data: { count: input.taTextLines, threshold: UNLOCK_TA_LINES },
  };

  const conditions = [cheap, blindHitRate, blindReasons, taTextLines];
  return {
    conditions,
    reference: discriminatorReference(input.persona),
    unlocked: conditions.every((condition) => condition.satisfied === true),
  };
}

function stateText(condition: UnlockCondition, locale: Locale): string {
  if (condition.satisfied === null) return copy(locale, "unlock.noData");
  return copy(locale, condition.satisfied ? "unlock.met" : "unlock.notMet");
}

function yesNo(value: unknown, locale: Locale): string {
  return value === true ? copy(locale, "unlock.yes") : copy(locale, "unlock.no");
}

function percent(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * The lines the command prints: the four conditions, two references, and
 * the verdict.
 */
export function formatUnlockCheck(report: UnlockCheckReport, locale: Locale): string[] {
  const lines: string[] = [];
  const byKey = new Map(report.conditions.map((condition) => [condition.key, condition]));

  const cheap = byKey.get("cheapLayers")!;
  lines.push(
    copy(locale, "unlock.cheapLayers", {
      state: stateText(cheap, locale),
      rules: yesNo(cheap.data.rules, locale),
      suppressions: yesNo(cheap.data.suppressions, locale),
      exemplars: yesNo(cheap.data.exemplars, locale),
      act: yesNo(cheap.data.act, locale),
      rerank: yesNo(cheap.data.rerank, locale),
    }),
  );

  const hit = byKey.get("blindHitRate")!;
  lines.push(
    hit.satisfied === null
      ? copy(locale, "unlock.blindHitRateNone")
      : copy(locale, "unlock.blindHitRate", {
          state: stateText(hit, locale),
          sittings: String(hit.data.sittings ?? 0),
          picked: percent(hit.data.pickedPersona),
        }),
  );

  const reasons = byKey.get("blindReasons")!;
  lines.push(
    reasons.satisfied === null
      ? copy(locale, "unlock.blindReasonsNone")
      : copy(locale, "unlock.blindReasons", {
          state: stateText(reasons, locale),
          word: String(reasons.data.word ?? 0),
          act: String(reasons.data.act ?? 0),
          total: String(reasons.data.total ?? 0),
        }),
  );

  const ta = byKey.get("taTextLines")!;
  lines.push(
    copy(locale, "unlock.taTextLines", {
      state: stateText(ta, locale),
      count: String(ta.data.count ?? 0),
    }),
  );

  lines.push(
    report.reference.auc == null
      ? copy(locale, "unlock.referenceAucNone")
      : copy(locale, "unlock.referenceAuc", {
          auc: report.reference.auc.toFixed(4),
        }),
  );

  lines.push(
    report.reference.tells.length === 0
      ? copy(locale, "unlock.referenceTellsNone")
      : copy(locale, "unlock.referenceTells", {
          tells: report.reference.tells
            .map((tell) =>
              copy(locale, "unlock.tell", {
                feature: tell.feature,
                category: copy(locale, TELL_CATEGORY_KEYS[tell.category]),
              }),
            )
            .join(" / "),
        }),
  );

  lines.push(`unlocked: ${report.unlocked ? "true" : "false"}`);
  return lines;
}
