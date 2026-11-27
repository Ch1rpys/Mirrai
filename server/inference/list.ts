/**
 * Everything the app worked out, in one place (C10.6).
 *
 * The search, the archive and the rules each lived where they were
 * used, so there was no single answer to "what does this app think it
 * knows about me?" — the user could not see the sum of it or turn a
 * part of it off. This module builds that answer: two sections, one
 * about the user and one about each persona, each item carrying where
 * it came from and what the user can do about it.
 *
 * It is a pure function of data the router gathers, so the shape can be
 * tested without a database. The sources are the four the manual names:
 *
 *   - measured  — computed from the records by `style.measure`
 *   - mined     — extracted automatically and not yet confirmed
 *   - confirmed — the user said yes to a candidate
 *   - written   — the user's own words
 */
import type { CopyKey } from "@shared/copy";
import {
  PERSONA_DOCUMENT_FIELDS,
  toText,
  type PersonaData,
} from "../_core/persona-schema";
import {
  STYLE_PROFILE_KEYS,
  normalizeStyleProfile,
  type StyleProfile,
  type StyleProfileKey,
} from "@shared/style-profile";
import {
  normalizeMicroRules,
  type MicroRule,
} from "@shared/micro-rules";
import { normalizeSuppressions, type Suppression } from "@shared/suppressions";
import { normalizeLifeEvents, type LifeEvent } from "@shared/life-events";
import { normalizePeople, type Person } from "@shared/people";
import { normalizeStances, type Stance } from "@shared/stances";
import { normalizeLexicon, type LexiconEntry } from "@shared/lexicon";
import { normalizeHarmReport } from "@shared/harm";

export type InferenceSource = "measured" | "mined" | "confirmed" | "written";

/** The kinds of candidate a rejection can remove. */
export const REJECTABLE_CANDIDATE_KINDS = [
  "microRules",
  "suppressions",
  "lifeEvents",
  "people",
  "stances",
  "lexicon",
] as const;

export type RejectableCandidateKind = (typeof REJECTABLE_CANDIDATE_KINDS)[number];

export type InferenceAction =
  | { kind: "deleteMemory"; memoryId: number }
  | { kind: "rejectCandidate"; candidateKind: RejectableCandidateKind; key: string }
  | { kind: "toggleStyleKey"; styleKey: StyleProfileKey; disabled: boolean }
  | { kind: "editPersona"; personaId: number };

export interface InferenceItem {
  /** Stable within one response; the client uses it as a React key. */
  id: string;
  /** A key from the server's copy table. */
  labelKey: CopyKey;
  labelParams?: Record<string, string | number>;
  source: InferenceSource;
  /** What it says, flattened to text. */
  detail?: string;
  /** The words or numbers behind it. */
  evidence?: string[];
  action?: InferenceAction;
  /** For a style profile key: the user has turned it off. */
  disabled?: boolean;
}

export interface InferenceSection {
  id: string;
  titleKey: CopyKey;
  titleParams?: Record<string, string | number>;
  items: InferenceItem[];
}

/**
 * The description key of every style profile key.
 *
 * Written out rather than built from the key, so the copy test can see
 * that every entry is read — and so a key added to `StyleProfile`
 * without a description is a missing-property type error.
 */
export const STYLE_PROFILE_KEY_COPY: Record<StyleProfileKey, CopyKey> = {
  fingerprint: "styleProfile.fingerprint",
  userSide: "styleProfile.userSide",
  rituals: "styleProfile.rituals",
  samplePool: "styleProfile.samplePool",
  imperfectionDrafts: "styleProfile.imperfectionDrafts",
  discriminator: "styleProfile.discriminator",
  replyDelay: "styleProfile.replyDelay",
  routine: "styleProfile.routine",
  typing: "styleProfile.typing",
  quirks: "styleProfile.quirks",
  doubleText: "styleProfile.doubleText",
  sessions: "styleProfile.sessions",
  inSession: "styleProfile.inSession",
  multiPoint: "styleProfile.multiPoint",
  emotionDynamics: "styleProfile.emotionDynamics",
  conflict: "styleProfile.conflict",
  triggers: "styleProfile.triggers",
  actClusters: "styleProfile.actClusters",
  addressHistory: "styleProfile.addressHistory",
  stickers: "styleProfile.stickers",
  voice: "styleProfile.voice",
  photos: "styleProfile.photos",
  calls: "styleProfile.calls",
  publicFingerprint: "styleProfile.publicFingerprint",
  writtenFingerprint: "styleProfile.writtenFingerprint",
  group: "styleProfile.group",
  mirror: "styleProfile.mirror",
  rerankWeights: "styleProfile.rerankWeights",
};

/** The label of each persona document field. */
const DOCUMENT_FIELD_COPY: Partial<Record<keyof PersonaData, CopyKey>> = {
  personality: "inference.field.personality",
  speakingStyle: "inference.field.speakingStyle",
  catchphrases: "inference.field.catchphrases",
  nickname: "inference.field.nickname",
  memories: "inference.field.memories",
  attachmentStyle: "inference.field.attachmentStyle",
  loveLanguage: "inference.field.loveLanguage",
  conflictStyle: "inference.field.conflictStyle",
  touchingMoments: "inference.field.touchingMoments",
  summary: "inference.field.summary",
};

export interface InferenceMemory {
  id: number;
  title: string;
  description?: string | null;
  category?: string;
  subject?: string;
  source?: string;
}

export interface InferencePersonaData {
  persona: {
    id: number;
    name: string;
    personaData: unknown;
    styleProfile: unknown;
    settings: unknown;
  };
  memories: InferenceMemory[];
  emotionTrend?: Array<{ date?: string; state?: string; intensity?: number; emotionalState?: string }>;
  /** The style profile keys this persona's owner turned off. */
  disabledProfiles?: string[];
}

export interface InferenceUserData {
  addressStyle?: string | null;
  boundaries?: string | null;
  trajectoryAssessment?: string | null;
  trajectoryLatest?: string | null;
  mood?: { date?: string; mood?: string; note?: string | null } | null;
  safetyEvents?: Array<{ type: string; severity?: string; createdAt?: Date | string }>;
  checkins?: Array<{ answer: string; personaName?: string; createdAt?: Date | string }>;
}

export interface BuildInferenceInput {
  user: InferenceUserData;
  personas: InferencePersonaData[];
}

/** Cuts a JSON-ish value down to something a person can read. */
function flatten(value: unknown, max = 4000): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value, null, 2).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

/** `source` for one confirmed/mined row. */
function sourceOf(row: { source?: string; verified?: boolean }): InferenceSource {
  if (row.verified === false) return "mined";
  return row.source === "manual" ? "written" : "confirmed";
}

/** The number of items per list, so one huge table does not swamp the page. */
const MAX_LIST_ITEMS = 60;

function clamp<T>(rows: T[], max = MAX_LIST_ITEMS): T[] {
  return rows.slice(0, max);
}

function styleProfileItems(
  personaId: number,
  name: string,
  rawProfile: unknown,
  disabled: Set<string>,
): InferenceItem[] {
  const stored = normalizeStyleProfile(rawProfile);
  const items: InferenceItem[] = [];
  for (const key of STYLE_PROFILE_KEYS) {
    const value = (stored as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    items.push({
      id: `style-${key}`,
      labelKey: STYLE_PROFILE_KEY_COPY[key],
      source: "measured",
      detail: flatten(value),
      evidence: stored.measuredAt ? [stored.measuredAt] : undefined,
      action: { kind: "toggleStyleKey", styleKey: key, disabled: disabled.has(key) },
      disabled: disabled.has(key),
    });
  }
  void personaId;
  void name;
  return items;
}

function documentFieldItems(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const data = (persona.personaData ?? {}) as PersonaData;
  const items: InferenceItem[] = [];
  for (const field of PERSONA_DOCUMENT_FIELDS) {
    const key = DOCUMENT_FIELD_COPY[field];
    if (!key) continue;
    const text = toText((data as unknown as Record<string, unknown>)[field]);
    if (!text) continue;
    items.push({
      id: `doc-${field}`,
      labelKey: key,
      source: "written",
      detail: flatten(text),
      action: { kind: "editPersona", personaId: persona.id },
    });
  }
  return items;
}

function microRuleItems(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const rules: MicroRule[] = normalizeMicroRules(
    (persona.personaData as { microRules?: unknown } | null)?.microRules,
  );
  return clamp(rules).map((rule) => ({
    id: `rule-${rule.id}`,
    labelKey: "inference.field.microRules" as CopyKey,
    source: sourceOf(rule),
    detail: `${rule.trigger.join(" / ")} → ${rule.meaning} — ${rule.rendering}`,
    evidence: rule.evidence.map((row) => row.snippet).filter(Boolean).slice(0, 5),
    action: rule.verified === false
      ? { kind: "rejectCandidate", candidateKind: "microRules", key: rule.id }
      : { kind: "editPersona", personaId: persona.id },
  }));
}

function suppressionItems(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const rows: Suppression[] = normalizeSuppressions(
    (persona.personaData as { suppressions?: unknown } | null)?.suppressions,
  );
  return clamp(rows).map((row) => ({
    id: `suppression-${row.id}`,
    labelKey: "inference.field.suppressions" as CopyKey,
    source: sourceOf(row),
    detail: row.pattern,
    evidence: row.evidence.map((e) => e.snippet).filter(Boolean).slice(0, 5),
    action: row.verified === false
      ? { kind: "rejectCandidate", candidateKind: "suppressions", key: row.id }
      : { kind: "editPersona", personaId: persona.id },
  }));
}

function lifeEventItems(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const rows: LifeEvent[] = normalizeLifeEvents(
    (persona.personaData as { lifeEvents?: unknown } | null)?.lifeEvents,
  );
  return clamp(rows).map((row) => ({
    id: `life-${row.id}`,
    labelKey: "inference.field.lifeEvents" as CopyKey,
    source: sourceOf(row),
    detail: `${row.title}${row.detail ? ` — ${row.detail}` : ""}`,
    evidence: row.evidence.map((e) => e.snippet).filter(Boolean).slice(0, 5),
    action: row.verified === false
      ? { kind: "rejectCandidate", candidateKind: "lifeEvents", key: row.id }
      : { kind: "editPersona", personaId: persona.id },
  }));
}

function peopleItems(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const rows: Person[] = normalizePeople(
    (persona.personaData as { people?: unknown } | null)?.people,
  );
  return clamp(rows).map((row) => ({
    id: `person-${row.id}`,
    labelKey: "inference.field.people" as CopyKey,
    source: sourceOf(row),
    detail: [row.name, row.relation].filter(Boolean).join(" · "),
    evidence: row.evidence.map((e) => e.snippet).filter(Boolean).slice(0, 5),
    action: row.verified === false
      ? { kind: "rejectCandidate", candidateKind: "people", key: row.id }
      : { kind: "editPersona", personaId: persona.id },
  }));
}

function stanceItems(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const rows: Stance[] = normalizeStances(
    (persona.personaData as { stances?: unknown } | null)?.stances,
  );
  return clamp(rows).map((row) => ({
    id: `stance-${row.id}`,
    labelKey: "inference.field.stances" as CopyKey,
    source: sourceOf(row),
    detail: `${row.topic} · ${row.statement}`,
    evidence: row.evidence.map((e) => e.snippet).filter(Boolean).slice(0, 5),
    action: row.verified === false
      ? { kind: "rejectCandidate", candidateKind: "stances", key: row.id }
      : { kind: "editPersona", personaId: persona.id },
  }));
}

function lexiconItems(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const rows: LexiconEntry[] = normalizeLexicon(
    (persona.personaData as { lexicon?: unknown } | null)?.lexicon,
  );
  return clamp(rows).map((row) => ({
    id: `lexicon-${row.id}`,
    labelKey: "inference.field.lexicon" as CopyKey,
    source: sourceOf(row),
    detail: `${row.term} — ${row.gloss}${row.count ? ` (${row.count})` : ""}`,
    evidence: row.evidence.map((e) => e.snippet).filter(Boolean).slice(0, 5),
    action: row.verified === false
      ? { kind: "rejectCandidate", candidateKind: "lexicon", key: row.id }
      : { kind: "editPersona", personaId: persona.id },
  }));
}

function memoryItems(
  personaId: number,
  name: string,
  memories: InferenceMemory[],
): InferenceItem[] {
  const items: InferenceItem[] = [];
  for (const memory of clamp(memories)) {
    const subject = memory.subject ?? "them";
    const labelKey: CopyKey = subject === "me"
      ? "inference.me.memories"
      : subject === "said"
        ? "inference.field.memoriesSaid"
        : "inference.field.memoriesThem";
    items.push({
      id: `memory-${personaId}-${memory.id}`,
      labelKey,
      labelParams: { name },
      source: memory.source === "manual" ? "written" : "mined",
      detail: memory.description ? `${memory.title} — ${memory.description}` : memory.title,
      action: { kind: "deleteMemory", memoryId: memory.id },
    });
  }
  return items;
}

function harmItem(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const report = normalizeHarmReport(
    (persona.personaData as { harmReport?: unknown } | null)?.harmReport,
  );
  if (!report || report.categories.length === 0) return [];
  return [{
    id: "harm-report",
    labelKey: "inference.field.harmReport" as CopyKey,
    source: report.decision === "keep" ? "confirmed" : "mined",
    detail: flatten({
      decision: report.decision,
      categories: report.categories.map((category) => ({
        kind: category.kind,
        count: category.count,
      })),
    }),
    action: { kind: "editPersona", personaId: persona.id },
  }];
}

function turningPointItems(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const rows = ((persona.personaData as { turningPoints?: unknown } | null)?.turningPoints);
  if (!Array.isArray(rows)) return [];
  return clamp(rows as Array<{
    id?: string;
    at?: string;
    status?: string;
    changes?: Array<{ series?: string }>;
  }>).map((row, index) => ({
    id: `turning-${row.id ?? index}`,
    labelKey: "inference.field.turningPoints" as CopyKey,
    source: row.status === "confirmed"
      ? "confirmed"
      : row.status === "rejected"
        ? "mined"
        : "mined",
    detail: flatten(row),
    action: { kind: "editPersona", personaId: persona.id },
  }));
}

function emotionHistoryItem(persona: InferencePersonaData): InferenceItem[] {
  const trend = persona.emotionTrend ?? [];
  if (trend.length === 0) return [];
  return [{
    id: "emotion-history",
    labelKey: "inference.field.emotionHistory" as CopyKey,
    source: "measured",
    detail: flatten(trend.slice(-30)),
  }];
}

function describedItems(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const rows = (persona.personaData as { described?: unknown } | null)?.described;
  if (!Array.isArray(rows)) return [];
  return clamp(rows as Array<{ text?: string; source?: string }>).flatMap((row, index) => {
    const text = toText(row.text);
    if (!text) return [];
    return [{
      id: `described-${index}`,
      labelKey: "inference.field.described" as CopyKey,
      source: "written" as InferenceSource,
      detail: text,
    }];
  });
}

function publicVoiceItem(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const voice = toText((persona.personaData as { publicVoice?: unknown } | null)?.publicVoice);
  if (!voice) return [];
  return [{
    id: "public-voice",
    labelKey: "inference.field.publicVoice" as CopyKey,
    source: "measured",
    detail: voice,
  }];
}

function openingProfileItem(persona: InferencePersonaData["persona"]): InferenceItem[] {
  const opening = (persona.personaData as { openingProfile?: unknown } | null)?.openingProfile;
  if (!opening) return [];
  return [{
    id: "opening-profile",
    labelKey: "inference.field.openingProfile" as CopyKey,
    source: "measured",
    detail: flatten(opening),
  }];
}

function personaSection(
  data: InferencePersonaData,
  disabled: Set<string>,
): InferenceSection {
  const persona = data.persona;
  const name = String(persona.name ?? "");
  return {
    id: `persona-${persona.id}`,
    titleKey: "inference.sectionPersona",
    titleParams: { name },
    items: [
      ...documentFieldItems(persona),
      ...microRuleItems(persona),
      ...suppressionItems(persona),
      ...lifeEventItems(persona),
      ...peopleItems(persona),
      ...stanceItems(persona),
      ...lexiconItems(persona),
      ...describedItems(persona),
      ...publicVoiceItem(persona),
      ...openingProfileItem(persona),
      ...harmItem(persona),
      ...turningPointItems(persona),
      ...emotionHistoryItem(data),
      ...styleProfileItems(persona.id, name, persona.styleProfile, disabled),
      ...memoryItems(persona.id, name, data.memories),
    ],
  };
}

function meSection(input: BuildInferenceInput): InferenceSection {
  const items: InferenceItem[] = [];
  const user = input.user;
  const address = [toText(user.addressStyle), toText(user.boundaries)].filter(Boolean).join("\n");
  if (address) {
    items.push({
      id: "me-address",
      labelKey: "inference.me.addressStyle",
      source: "written",
      detail: address,
    });
  }
  for (const entry of input.personas) {
    const name = String(entry.persona.name ?? "");
    const profile: StyleProfile = normalizeStyleProfile(entry.persona.styleProfile);
    if (profile.userSide) {
      items.push({
        id: `me-user-side-${entry.persona.id}`,
        labelKey: "inference.me.userSide",
        labelParams: { name },
        source: "measured",
        detail: flatten(profile.userSide),
      });
    }
    if (profile.mirror) {
      items.push({
        id: `me-mirror-${entry.persona.id}`,
        labelKey: "inference.me.mirror",
        labelParams: { name },
        source: "measured",
        detail: flatten(profile.mirror),
      });
    }
  }
  if (user.mood) {
    items.push({
      id: "me-mood",
      labelKey: "inference.me.mood",
      source: "written",
      detail: `${toText(user.mood.date)} · ${toText(user.mood.mood)}${user.mood.note ? ` — ${toText(user.mood.note)}` : ""}`,
    });
  }
  for (const checkin of clamp(user.checkins ?? [], 20)) {
    items.push({
      id: `me-checkin-${items.length}-${toText(checkin.createdAt)}`,
      labelKey: "inference.me.checkin",
      labelParams: checkin.personaName ? { name: checkin.personaName } : undefined,
      source: "written",
      detail: toText(checkin.answer),
    });
  }
  for (const event of clamp(user.safetyEvents ?? [], 20)) {
    items.push({
      id: `me-safety-${items.length}-${toText(event.createdAt)}`,
      labelKey: "inference.me.safety",
      source: "mined",
      detail: `${event.type}${event.severity ? ` · ${event.severity}` : ""}`,
      evidence: event.createdAt ? [toText(event.createdAt)] : undefined,
    });
  }
  for (const entry of input.personas) {
    const mine = entry.memories.filter((memory) => (memory.subject ?? "them") === "me");
    if (mine.length === 0) continue;
    items.push({
      id: `me-memories-${entry.persona.id}`,
      labelKey: "inference.me.memories",
      labelParams: { name: String(entry.persona.name ?? "") },
      source: "mined",
      detail: mine.map((memory) => memory.title).join("\n").slice(0, 4000),
      action: { kind: "editPersona", personaId: entry.persona.id },
    });
  }
  const assessment = user.trajectoryAssessment ?? "auto";
  items.push({
    id: "me-trajectory",
    labelKey: "inference.me.trajectory",
    source: "written",
    detail: assessment,
    ...(user.trajectoryLatest
      ? { evidence: [user.trajectoryLatest] }
      : {}),
  });
  return { id: "me", titleKey: "inference.sectionMe", items };
}

/**
 * Builds both blocks.
 *
 * An empty section is returned as empty rather than hidden: the page
 * says there is nothing yet, which is different from a failed read.
 */
export function buildInferenceSections(input: BuildInferenceInput): InferenceSection[] {
  return [
    meSection(input),
    ...input.personas.map((entry) => (
      personaSection(entry, new Set(entry.disabledProfiles ?? []))
    )),
  ];
}

/**
 * Whether the persona's records have been measured at all.
 *
 * The page uses it to say "nothing yet" for a persona that has no
 * records, which is not a failure.
 */
export function personaHasMeasurements(entry: InferencePersonaData): boolean {
  const profile = normalizeStyleProfile(entry.persona.styleProfile);
  return STYLE_PROFILE_KEYS.some(
    (key) => (profile as unknown as Record<string, unknown>)[key] !== undefined,
  );
}
