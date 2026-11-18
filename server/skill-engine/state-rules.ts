/**
 * Discriminative-rule candidates from a per-state fingerprint.
 *
 * A contrast pair needs two almost-identical lines. A state fingerprint
 * already knows that distant ends on a period and the rest do not. That
 * is the same kind of distinction, counted rather than guessed.
 */
import { copy, type CopyKey, type Locale } from "@shared/copy";
import { isTextRecord } from "@shared/records";
import type { MicroRule, MicroRuleEvidence } from "@shared/micro-rules";
import {
  defaultAddressForms,
  endingClassOf,
  FINGERPRINT_STATES,
  lastParticleOf,
  measureFingerprint,
  type EmotionalState,
  type FingerprintRow,
  type StyleFingerprint,
  type StyleFingerprintCore,
} from "@shared/style-fingerprint";

export interface StateRuleRow {
  role: string;
  content: string;
  timestamp?: Date | string | null;
  kind?: string | null;
  emotion?: string | null;
}

const EMOTION_LABEL: Record<EmotionalState, CopyKey> = {
  warm: "labels.emotion.warm",
  playful: "labels.emotion.playful",
  nostalgic: "labels.emotion.nostalgic",
  melancholy: "labels.emotion.melancholy",
  happy: "labels.emotion.happy",
  distant: "labels.emotion.distant",
};

export function mineStateRules(params: {
  fingerprint: StyleFingerprint | null | undefined;
  rows: StateRuleRow[];
  locale?: Locale;
}): MicroRule[] {
  const fingerprint = params.fingerprint;
  const perState = fingerprint?.perState;
  if (!fingerprint || !perState) return [];
  const locale = params.locale ?? "zh";
  const addressForms = Object.keys(fingerprint.address ?? {});
  const out: MicroRule[] = [];

  for (const state of FINGERPRINT_STATES) {
    const core = perState[state];
    if (!core) continue;
    const restRows = params.rows.filter(
      (row) =>
        isRoleText(row) &&
        isEmotionalState(row.emotion) &&
        row.emotion !== state,
    );
    const rest = measureFingerprint(restRows, { addressForms });
    if (!rest) continue;
    const stateRows = params.rows.filter(
      (row) => isRoleText(row) && row.emotion === state,
    );

    if (core.endings.period >= 0.5 && rest.endings.period <= 0.1) {
      pushRule(out, {
        state,
        trigger: ["。"],
        rate: core.endings.period,
        rendering: copy(locale, "v6.stateRule.period"),
        locale,
        rows: stateRows,
        matches: (text) => text.includes("。"),
      });
    }

    for (const form of addressForms) {
      if (!form) continue;
      const here = core.address[form] ?? 0;
      const there = rest.address[form] ?? 0;
      if (here >= 0.1 && there <= 0.01) {
        pushRule(out, {
          state,
          trigger: [form],
          rate: here,
          rendering: copy(locale, "v6.stateRule.address"),
          locale,
          rows: stateRows,
          matches: (text) => text.includes(form),
        });
      }
    }

    for (const [particle, here] of Object.entries(core.particles)) {
      if (particle === "none") continue;
      const there = rest.particles[particle] ?? 0;
      if (here >= 0.2 && there <= 0.03) {
        pushRule(out, {
          state,
          trigger: [particle],
          rate: here,
          rendering: copy(locale, "v6.stateRule.particle"),
          locale,
          rows: stateRows,
          matches: (text) => lastParticleOf(text) === particle,
        });
      }
    }

    if (core.endings.ellipsis >= 0.3 && rest.endings.ellipsis <= 0.05) {
      const token = dominantEllipsis(core);
      if (token) {
        pushRule(out, {
          state,
          trigger: [token],
          rate: core.endings.ellipsis,
          rendering: copy(locale, "v6.stateRule.ellipsis"),
          locale,
          rows: stateRows,
          matches: (text) => endingClassOf(text) === "ellipsis" && text.includes(token),
        });
      }
    }
  }

  return out;
}

/** Nickname, names, and the default forms — the same set the style profile uses. */
export function addressFormsForMining(params: {
  name?: string | null;
  nickname?: string | null;
  userName?: string | null;
}): string[] {
  return [
    ...new Set(
      [params.nickname, params.userName, params.name, ...defaultAddressForms()]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  ];
}

export function stateRulesFromTranscript(
  rows: StateRuleRow[],
  options: {
    locale?: Locale;
    name?: string | null;
    nickname?: string | null;
    userName?: string | null;
    addressForms?: string[];
  } = {},
): MicroRule[] {
  const addressForms = options.addressForms ?? addressFormsForMining(options);
  const fingerprint = measureFingerprint(rows, { addressForms });
  return mineStateRules({ fingerprint, rows, locale: options.locale });
}

function pushRule(
  out: MicroRule[],
  spec: {
    state: EmotionalState;
    trigger: string[];
    rate: number;
    rendering: string;
    locale: Locale;
    rows: StateRuleRow[];
    matches: (text: string) => boolean;
  },
): void {
  const evidence = evidenceOf(spec.rows, spec.matches);
  if (evidence.length < 3) return;
  out.push({
    id: `auto-state-${spec.state}-${ruleHash(spec.trigger)}`,
    trigger: spec.trigger,
    meaning: copy(spec.locale, EMOTION_LABEL[spec.state]),
    rendering: spec.rendering,
    confidence: Math.min(0.9, spec.rate),
    source: "auto",
    verified: false,
    evidence,
  });
}

function evidenceOf(
  rows: StateRuleRow[],
  matches: (text: string) => boolean,
): MicroRuleEvidence[] {
  const out: MicroRuleEvidence[] = [];
  for (const row of rows) {
    const snippet = String(row.content ?? "").trim();
    if (!snippet || !matches(snippet)) continue;
    const at = isoOf(row.timestamp);
    out.push(at ? { at, snippet } : { snippet });
    if (out.length >= 3) break;
  }
  return out;
}

function dominantEllipsis(fp: StyleFingerprintCore): string | null {
  const forms = fp.punctuation.ellipsisForms;
  const ranked: Array<[string, number]> = [
    ["…", forms.unicode],
    ["...", forms.dots],
    ["。。。", forms.cjkDots],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const [token, count] = ranked[0]!;
  const total = forms.unicode + forms.dots + forms.cjkDots;
  if (total < 1 || count / total < 0.5) return token;
  return token;
}

function ruleHash(trigger: string[]): string {
  const source = trigger.join("|");
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)!) | 0;
  }
  return Math.abs(hash).toString(36);
}

function isRoleText(row: StateRuleRow): boolean {
  return row.role === "assistant" && isTextRecord(row);
}

function isEmotionalState(value: unknown): value is EmotionalState {
  return typeof value === "string" && (FINGERPRINT_STATES as readonly string[]).includes(value);
}

function isoOf(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/** Fingerprint rows the miner can pass straight to `measureFingerprint`. */
export function fingerprintRowsFrom(rows: StateRuleRow[]): FingerprintRow[] {
  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    emotion: row.emotion,
  }));
}
