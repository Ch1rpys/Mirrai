/**
 * Questions asked after a distillation, from a closed set.
 *
 * The model is not asked to invent what to ask. Each question is a
 * gap in what the records could measure, and the answer is written
 * into a known field — never into free-form persona prose.
 */
import type { StickerStats } from "./sticker-stats";
import { copy, type Locale } from "./copy";
import type { ImperfectionEntry } from "./imperfection";
import type { MicroRule } from "./micro-rules";
import { normalizeMicroRules } from "./micro-rules";
import { normalizeRituals, type RitualEntry } from "./ritual-table";
import type { StyleProfile } from "./style-profile";
import { normalizeStyleProfile } from "./style-profile";
import type { Suppression } from "./suppressions";
import { normalizeSuppressions } from "./suppressions";
import { isTextRecord } from "./records";

export const CLARIFY_MAX = 12;
export const CLARIFY_TEXT_MAX = 40;
export const CLARIFY_CONFIRM_MAX = 3;

export const CLARIFY_KINDS = [
  "address_normal",
  "address_angry",
  "period_angry",
  "laugh_form",
  "goodnight",
  "when_sad",
  "conflict_first",
  "sticker_habit",
  "never_says",
  "avoid_topic",
  "confirm_rule",
] as const;

export type ClarifyKind = (typeof CLARIFY_KINDS)[number];

export interface ClarifyCounts {
  distantLines: number;
  melancholyLines: number;
  laughSamples: number;
  conflictCount: number;
}

export interface ClarifyChoice {
  value: string;
  label: string;
}

export interface Clarification {
  id: string;
  kind: ClarifyKind;
  prompt: string;
  input: "text" | "choice" | "text-or-same" | "skipable-text";
  choices?: ClarifyChoice[];
  ruleId?: string;
}

export interface ClarifyPersonaSlice {
  nickname?: string;
  catchphrases?: string[];
  microRules?: MicroRule[];
  suppressions?: Suppression[];
  imperfectionProfile?: ImperfectionEntry[];
  rejectedFeedbackKeys?: string[];
  clarified?: string[];
}

export interface ClarifyPatch {
  personaData: ClarifyPersonaSlice;
  styleProfile: StyleProfile;
}

// i18n:allow-input — matched against laughs in the records, not shown as copy.
const LAUGH = /哈{2,}|haha+|hhh+|233+/i;

function clip(text: string): string {
  const trimmed = text.trim();
  return Array.from(trimmed).slice(0, CLARIFY_TEXT_MAX).join("");
}

function isUnsure(answer: string): boolean {
  const value = answer.trim().toLowerCase();
  return (
    value === "" ||
    value === "unsure" ||
    value === copy("zh", "clarify.unsure") ||
    value === copy("en", "clarify.unsure").toLowerCase()
  );
}

function isSameAsUsual(answer: string): boolean {
  const value = answer.trim();
  return (
    value === "same" ||
    value === copy("zh", "clarify.same") ||
    value === copy("en", "clarify.same")
  );
}

function fingerprintAddress(styleProfile: StyleProfile | null | undefined): string {
  const address = styleProfile?.fingerprint?.address;
  if (!address || typeof address !== "object") return "";
  const ranked = Object.entries(address)
    .filter(([, rate]) => typeof rate === "number" && rate > 0)
    .sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? "";
}

function ritualList(styleProfile: StyleProfile | null | undefined): RitualEntry[] {
  return normalizeRituals(styleProfile?.rituals);
}

// i18n:allow-input — matched against a measured ritual cue, not shown as copy.
function hasGoodnightRitual(styleProfile: StyleProfile | null | undefined): boolean {
  return ritualList(styleProfile).some((row) => {
    const cue = [row.trigger, ...row.variants].join(" ");
    return cue.includes("晚安") || cue.toLowerCase().includes("goodnight");
  });
}

function hasStickerStats(styleProfile: StyleProfile | null | undefined): boolean {
  return styleProfile?.stickers != null;
}

function isFallbackNickname(value: string | undefined, locale: Locale): boolean {
  const nickname = (value ?? "").trim();
  if (!nickname) return true;
  return (
    nickname === copy("zh", "labels.persona.fallbackNickname") ||
    nickname === copy("en", "labels.persona.fallbackNickname") ||
    nickname === copy(locale, "labels.persona.fallbackNickname")
  );
}

function already(clarified: string[] | undefined, id: string): boolean {
  return (clarified ?? []).includes(id);
}

function confirmCandidates(rules: MicroRule[] | undefined): MicroRule[] {
  return (rules ?? []).filter(
    (rule) => !rule.verified && rule.evidence.length === 1,
  ).slice(0, CLARIFY_CONFIRM_MAX);
}

/**
 * How many conflicts the persona has actually shown.
 *
 * Once the conflict profile has been measured (B4.4), it is the truth:
 * a repair-act count is only a stand-in for a log that has not been
 * through the conflict miner yet. Counting `act === "repair"` alone
 * asked "who speaks first after a fight" of a persona with six
 * measured fights whose repair lines were labelled as something else.
 */
function measuredConflictCount(
  style: StyleProfile | null | undefined,
  counts: ClarifyCounts,
): number {
  const measured = style?.conflict?.episodes;
  return typeof measured === "number" && measured >= 0
    ? measured
    : counts.conflictCount;
}

function choice(locale: Locale, key: Parameters<typeof copy>[1], value: string): ClarifyChoice {
  return { value, label: copy(locale, key) };
}

type ClarifyRow = {
  role?: string;
  content?: string | null;
  kind?: string | null;
  emotion?: string | null;
  act?: string | null;
};

function emptyCounts(): ClarifyCounts {
  return { distantLines: 0, melancholyLines: 0, laughSamples: 0, conflictCount: 0 };
}

function addClarifyRow(counts: ClarifyCounts, row: ClarifyRow): void {
  if (row.role !== "assistant") return;
  if (!isTextRecord({ kind: row.kind ?? "text" })) return;
  const content = String(row.content ?? "");
  if (row.emotion === "distant") counts.distantLines += 1;
  if (row.emotion === "melancholy") counts.melancholyLines += 1;
  if (LAUGH.test(content)) counts.laughSamples += 1;
  if (row.act === "repair") counts.conflictCount += 1;
}

export function measureClarifyCounts(rows: ClarifyRow[]): ClarifyCounts {
  const counts = emptyCounts();
  for (const row of rows) addClarifyRow(counts, row);
  return counts;
}

export async function measureClarifyCountsFromRecords(
  rows: AsyncIterable<ClarifyRow>,
): Promise<ClarifyCounts> {
  const counts = emptyCounts();
  for await (const row of rows) addClarifyRow(counts, row);
  return counts;
}

export function pickClarifications(params: {
  personaData: ClarifyPersonaSlice;
  styleProfile?: StyleProfile | null;
  counts: ClarifyCounts;
  name: string;
  locale?: Locale;
}): Clarification[] {
  const locale = params.locale ?? "zh";
  const name = params.name;
  const clarified = params.personaData.clarified ?? [];
  const style = params.styleProfile ?? normalizeStyleProfile(null);
  const out: Clarification[] = [];

  const push = (item: Clarification) => {
    if (already(clarified, item.id)) return;
    if (out.length >= CLARIFY_MAX) return;
    out.push(item);
  };

  if (!fingerprintAddress(style)) {
    push({
      id: "address_normal",
      kind: "address_normal",
      prompt: copy(locale, "clarify.address_normal", { name }),
      input: "text",
    });
  }
  if (params.counts.distantLines < 20) {
    push({
      id: "address_angry",
      kind: "address_angry",
      prompt: copy(locale, "clarify.address_angry", { name }),
      input: "text-or-same",
    });
    push({
      id: "period_angry",
      kind: "period_angry",
      prompt: copy(locale, "clarify.period_angry", { name }),
      input: "choice",
      choices: [
        choice(locale, "clarify.will", "yes"),
        choice(locale, "clarify.wont", "no"),
        choice(locale, "clarify.unsure", "unsure"),
      ],
    });
  }
  if (params.counts.laughSamples < 10) {
    push({
      id: "laugh_form",
      kind: "laugh_form",
      prompt: copy(locale, "clarify.laugh_form", { name }),
      input: "text",
    });
  }
  if (!hasGoodnightRitual(style)) {
    push({
      id: "goodnight",
      kind: "goodnight",
      prompt: copy(locale, "clarify.goodnight", { name }),
      input: "text",
    });
  }
  if (params.counts.melancholyLines < 20) {
    push({
      id: "when_sad",
      kind: "when_sad",
      prompt: copy(locale, "clarify.when_sad", { name }),
      input: "choice",
      choices: [
        choice(locale, "clarify.whenSad.advise", "advise"),
        choice(locale, "clarify.whenSad.stay", "stay"),
        choice(locale, "clarify.whenSad.joke", "joke"),
        choice(locale, "clarify.whenSad.close", "close"),
        choice(locale, "clarify.whenSad.ask", "ask"),
      ],
    });
  }
  if (measuredConflictCount(style, params.counts) < 3) {
    push({
      id: "conflict_first",
      kind: "conflict_first",
      prompt: copy(locale, "clarify.conflict_first"),
      input: "choice",
      choices: [
        { value: "them", label: name },
        choice(locale, "clarify.me", "me"),
        choice(locale, "clarify.either", "either"),
      ],
    });
  }
  if (!hasStickerStats(style)) {
    push({
      id: "sticker_habit",
      kind: "sticker_habit",
      prompt: copy(locale, "clarify.sticker_habit", { name }),
      input: "choice",
      choices: [
        choice(locale, "clarify.sticker.often", "often"),
        choice(locale, "clarify.sticker.sometimes", "sometimes"),
        choice(locale, "clarify.sticker.rarely", "rarely"),
      ],
    });
  }
  push({
    id: "never_says",
    kind: "never_says",
    prompt: copy(locale, "clarify.never_says", { name }),
    input: "skipable-text",
  });
  push({
    id: "avoid_topic",
    kind: "avoid_topic",
    prompt: copy(locale, "clarify.avoid_topic", { name }),
    input: "skipable-text",
  });
  for (const rule of confirmCandidates(params.personaData.microRules)) {
    push({
      id: `confirm_rule:${rule.id}`,
      kind: "confirm_rule",
      prompt: copy(locale, "clarify.confirm_rule", {
        name,
        trigger: rule.trigger.join(locale === "en" ? ", " : "、"),
        meaning: rule.meaning,
      }),
      input: "choice",
      ruleId: rule.id,
      choices: [
        choice(locale, "clarify.yes", "yes"),
        choice(locale, "clarify.no", "no"),
        choice(locale, "clarify.unsure", "unsure"),
      ],
    });
  }
  return out.slice(0, CLARIFY_MAX);
}

function markClarified(persona: ClarifyPersonaSlice, id: string): string[] {
  return [...new Set([...(persona.clarified ?? []), id])];
}

function manualRule(params: {
  id: string;
  trigger: string[];
  meaning: string;
  rendering: string;
}): MicroRule {
  return {
    id: params.id,
    trigger: params.trigger,
    meaning: params.meaning,
    rendering: params.rendering,
    confidence: 1,
    source: "manual",
    verified: true,
    evidence: [],
  };
}

function manualSuppression(kind: "no_phrase" | "avoid_topic", pattern: string): Suppression {
  return {
    id: `clarify-${kind}`,
    pattern,
    kind,
    confidence: 1,
    source: "manual",
    verified: true,
    evidence: [],
  };
}

// i18n:allow-input — answers and stored tokens, not shown as copy.
export function applyClarification(
  question: Clarification,
  answer: string,
  ctx: {
    personaData: ClarifyPersonaSlice;
    styleProfile?: StyleProfile | null;
    locale?: Locale;
    name?: string;
    skip?: boolean;
  },
): ClarifyPatch | null {
  const locale = ctx.locale ?? "zh";
  const persona = { ...ctx.personaData };
  const style = normalizeStyleProfile(ctx.styleProfile);
  const skip = ctx.skip === true || isUnsure(answer);
  const text = clip(answer);

  if (skip && question.kind !== "confirm_rule") {
    return {
      personaData: { ...persona, clarified: markClarified(persona, question.id) },
      styleProfile: style,
    };
  }

  switch (question.kind) {
    case "address_normal": {
      if (!text) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      const nickname = isFallbackNickname(persona.nickname, locale) ? text : persona.nickname;
      return {
        personaData: { ...persona, nickname, clarified: markClarified(persona, question.id) },
        styleProfile: style,
      };
    }
    case "address_angry": {
      if (isSameAsUsual(answer) || !text) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      return {
        personaData: {
          ...persona,
          microRules: [
            ...normalizeMicroRules(persona.microRules),
            manualRule({
              id: "clarify-address-angry",
              trigger: [text],
              meaning: copy(locale, "clarify.addressAngry.meaning"),
              rendering: copy(locale, "clarify.addressAngry.rendering"),
            }),
          ],
          clarified: markClarified(persona, question.id),
        },
        styleProfile: style,
      };
    }
    case "period_angry": {
      const value = answer.trim().toLowerCase();
      const yes =
        value === "yes" ||
        value === copy("zh", "clarify.will") ||
        value === copy("en", "clarify.will").toLowerCase();
      if (!yes) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      const profile = [...(persona.imperfectionProfile ?? [])];
      const distant = profile.find((row) => row.state === "distant");
      const note = copy(locale, "clarify.periodAngry.note");
      if (distant) {
        if (!distant.deviations.includes(note)) distant.deviations = [...distant.deviations, note];
      } else {
        profile.push({ state: "distant", deviations: [note] });
      }
      return {
        personaData: {
          ...persona,
          imperfectionProfile: profile,
          clarified: markClarified(persona, question.id),
        },
        styleProfile: style,
      };
    }
    case "laugh_form": {
      if (!text) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      const catchphrases = [...(persona.catchphrases ?? [])];
      if (!catchphrases.includes(text)) catchphrases.push(text);
      return {
        personaData: { ...persona, catchphrases, clarified: markClarified(persona, question.id) },
        styleProfile: style,
      };
    }
    case "goodnight": {
      if (!text) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      return {
        personaData: { ...persona, clarified: markClarified(persona, question.id) },
        styleProfile: {
          ...style,
          rituals: [
            ...ritualList(style),
            {
              trigger: locale === "en" ? "goodnight" : "晚安",
              variants: [locale === "en" ? "goodnight" : "晚安"],
              n: 1,
              replies: [{ text, n: 1, recordId: 0 }],
              coverage: 1,
              manual: true,
            },
          ],
        },
      };
    }
    case "when_sad": {
      const rendering = whenSadRendering(answer, locale);
      if (!rendering) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      return {
        personaData: {
          ...persona,
          microRules: [
            ...normalizeMicroRules(persona.microRules),
            manualRule({
              id: "clarify-when-sad",
              trigger: locale === "en" ? ["sad", "upset"] : ["难过", "不开心"],
              meaning: copy(locale, "clarify.whenSad.meaning"),
              rendering,
            }),
          ],
          clarified: markClarified(persona, question.id),
        },
        styleProfile: style,
      };
    }
    case "conflict_first": {
      const rendering = conflictFirstRendering(answer, ctx.name ?? "", locale);
      if (!rendering) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      return {
        personaData: {
          ...persona,
          microRules: [
            ...normalizeMicroRules(persona.microRules),
            manualRule({
              id: "clarify-conflict-first",
              trigger: locale === "en" ? ["after a fight"] : ["吵架", "吵完"],
              meaning: copy(locale, "clarify.conflictFirst.meaning"),
              rendering,
            }),
          ],
          clarified: markClarified(persona, question.id),
        },
        styleProfile: style,
      };
    }
    case "sticker_habit": {
      const rate = stickerRate(answer);
      if (rate == null) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      const stickers =
        style.stickers && typeof style.stickers === "object" && !Array.isArray(style.stickers)
          ? { ...style.stickers, manualRate: rate }
          : ({ manualRate: rate } as StickerStats);
      return {
        personaData: { ...persona, clarified: markClarified(persona, question.id) },
        styleProfile: { ...style, stickers },
      };
    }
    case "never_says": {
      if (!text) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      return {
        personaData: {
          ...persona,
          suppressions: [...normalizeSuppressions(persona.suppressions), manualSuppression("no_phrase", text)],
          clarified: markClarified(persona, question.id),
        },
        styleProfile: style,
      };
    }
    case "avoid_topic": {
      if (!text) {
        return {
          personaData: { ...persona, clarified: markClarified(persona, question.id) },
          styleProfile: style,
        };
      }
      return {
        personaData: {
          ...persona,
          suppressions: [...normalizeSuppressions(persona.suppressions), manualSuppression("avoid_topic", text)],
          clarified: markClarified(persona, question.id),
        },
        styleProfile: style,
      };
    }
    case "confirm_rule": {
      const value = answer.trim().toLowerCase();
      const yes =
        value === "yes" ||
        value === copy("zh", "clarify.yes") ||
        value === copy("en", "clarify.yes").toLowerCase();
      const no =
        value === "no" ||
        value === copy("zh", "clarify.no") ||
        value === copy("en", "clarify.no").toLowerCase();
      const rules = normalizeMicroRules(persona.microRules);
      const ruleId = question.ruleId;
      if (yes && ruleId) {
        return {
          personaData: {
            ...persona,
            microRules: rules.map((rule) =>
              rule.id === ruleId ? { ...rule, verified: true, source: "manual" as const } : rule,
            ),
            clarified: markClarified(persona, question.id),
          },
          styleProfile: style,
        };
      }
      if (no && ruleId) {
        return {
          personaData: {
            ...persona,
            microRules: rules.filter((rule) => rule.id !== ruleId),
            rejectedFeedbackKeys: [...(persona.rejectedFeedbackKeys ?? []), `rule:${ruleId}`],
            clarified: markClarified(persona, question.id),
          },
          styleProfile: style,
        };
      }
      return {
        personaData: { ...persona, clarified: markClarified(persona, question.id) },
        styleProfile: style,
      };
    }
    default:
      return null;
  }
}

// i18n:allow-input — choice labels the user can type, not shown as copy.
function whenSadRendering(answer: string, locale: Locale): string | null {
  const value = answer.trim();
  const map: Record<string, "clarify.whenSad.advise" | "clarify.whenSad.stay" | "clarify.whenSad.joke" | "clarify.whenSad.close" | "clarify.whenSad.ask"> = {
    advise: "clarify.whenSad.advise",
    讲道理: "clarify.whenSad.advise",
    stay: "clarify.whenSad.stay",
    陪着不多说: "clarify.whenSad.stay",
    joke: "clarify.whenSad.joke",
    逗你笑: "clarify.whenSad.joke",
    close: "clarify.whenSad.close",
    说些亲近的话: "clarify.whenSad.close",
    ask: "clarify.whenSad.ask",
    问你怎么了: "clarify.whenSad.ask",
  };
  const key = map[value];
  return key ? copy(locale, key) : null;
}

// i18n:allow-input — choice labels the user can type, not shown as copy.
function conflictFirstRendering(answer: string, name: string, locale: Locale): string | null {
  const value = answer.trim();
  if (value === "them" || value === name) return copy(locale, "clarify.conflictFirst.them", { name });
  if (value === "me" || value === "我") return copy(locale, "clarify.conflictFirst.me");
  if (value === "either" || value === "不一定") return copy(locale, "clarify.conflictFirst.either");
  return null;
}

// i18n:allow-input — choice labels the user can type, not shown as copy.
function stickerRate(answer: string): number | null {
  const value = answer.trim();
  if (value === "often" || value === "很多") return 0.3;
  if (value === "sometimes" || value === "偶尔") return 0.1;
  if (value === "rarely" || value === "几乎不发") return 0;
  return null;
}
