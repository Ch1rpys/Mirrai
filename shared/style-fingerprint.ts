/**
 * A count of how this person writes.
 *
 * Nothing here is inferred. A field that does not have enough lines is
 * simply absent. Later entries turn the same numbers into a distance,
 * a projection, and a discriminator.
 */
import { isTextRecord } from "./records";
import { toTurns } from "./scenes";

export const FINGERPRINT_STATES = [
  "warm",
  "playful",
  "nostalgic",
  "melancholy",
  "happy",
  "distant",
] as const;
export type EmotionalState = (typeof FINGERPRINT_STATES)[number];

function isEmotionalState(value: unknown): value is EmotionalState {
  return typeof value === "string" && (FINGERPRINT_STATES as readonly string[]).includes(value);
}

export const MIN_FINGERPRINT_SAMPLES = 40;
export const MIN_FINGERPRINT_STATE_SAMPLES = 20;
export const MIN_FINGERPRINT_PERIOD_SAMPLES = 40;
export const MIN_FINGERPRINT_NEVER_SAMPLES = 1000;

export const LENGTH_HIST_MAX = 60;
export const HA_RUN_MAX = 10;
export const MARK_RUN_MAX = 5;

export const ENDING_CLASSES = [
  "period",
  "ellipsis",
  "question",
  "exclaim",
  "tilde",
  "emoji",
  "particle",
  "other",
] as const;
export type EndingClass = (typeof ENDING_CLASSES)[number];

// i18n:allow-input — matched against lines in the records, not shown as copy.
export const PARTICLES = [
  "啊",
  "呀",
  "啦",
  "嘛",
  "呢",
  "哦",
  "噢",
  "吧",
  "呗",
  "哈",
  "嘿",
  "耶",
  "哟",
  "捏",
  "诶",
  "欸",
  "惹",
  "叭",
  "呐",
  "喔",
] as const;

// i18n:allow-input — matched against lines in the records, not shown as copy.
export const TRADITIONAL_MARKERS = [
  "們",
  "這",
  "個",
  "說",
  "會",
  "沒",
  "為",
  "還",
  "過",
  "麼",
  "嗎",
  "裡",
  "對",
  "時",
  "來",
  "讓",
  "給",
  "歡",
  "愛",
  "謝",
] as const;

// i18n:allow-input — matched against lines in the records, not shown as copy.
export const ADDRESS_WORDS_ZH = [
  "宝贝",
  "宝宝",
  "亲爱的",
  "老婆",
  "老公",
  "小可爱",
  "小笨蛋",
  "小朋友",
  "哥哥",
  "姐姐",
  "宝儿",
] as const;

export const ADDRESS_WORDS_EN = ["baby", "babe", "dear", "honey", "love", "darling"] as const;

// i18n:allow-input — matched against lines in the records, not shown as copy.
const REDUPLICATION_KEYS = ["嗯", "好", "对", "行", "哦", "嗷"] as const;

const PARTICLE_SET = new Set<string>(PARTICLES);
const TRADITIONAL_SET = new Set<string>(TRADITIONAL_MARKERS);

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const EMOJI_ALL_RE = /\p{Extended_Pictographic}/gu;
const ELLIPSIS_UNICODE_RE = /…+/g;
const ELLIPSIS_DOTS_RE = /\.{3,}/g;
const ELLIPSIS_CJK_RE = /。{2,}|⋯+/g;
const HA_RUN_RE = /哈{2,}/g;
const LATIN_RE = /[A-Za-z]/;
const LATIN_ABBR_RE = /[A-Za-z]{2,}/g;
const HALF_MARK_RE = /[?!,]/g;
const FULL_MARK_RE = /[？！，]/g;
const COMMA_RE = /[,，]/g;
const EXCLAIM_RUN_RE = /[！!]+/g;
const QUESTION_RUN_RE = /[？?]+/g;

// i18n:allow-input — matched against lines in the records, not shown as copy.
const LAUGH_RES: Array<{ key: string; re: RegExp }> = [
  { key: "哈", re: /哈{2,}/ },
  { key: "h", re: /h{2,}/i },
  { key: "嘿", re: /嘿{2,}/ },
  { key: "呵", re: /呵{2,}/ },
  { key: "嘻", re: /嘻{2,}/ },
  { key: "笑死", re: /笑死/ },
  { key: "233", re: /233+/ },
  { key: "lol", re: /\blol\b/i },
  { key: "www", re: /\bwww\b/i },
];

// i18n:allow-input — matched against lines in the records, not shown as copy.
const KAOMOJI_RE = /orz|otz|qwq|qaq|t_t|t\.t|>_<|@\.@|→_→|←_←/i;

// i18n:allow-input — trailing marks peeled off records, not shown as copy.
const TRAILING_MARKS = new Set([
  "。",
  "．",
  ".",
  "？",
  "?",
  "！",
  "!",
  "…",
  "⋯",
  "～",
  "~",
  ",",
  "，",
  "、",
  "；",
  ";",
  "：",
  ":",
  "）",
  ")",
  "】",
  "]",
  "》",
  ">",
  '"',
  "'",
  "”",
  "’",
]);

export interface FingerprintRow {
  id?: number;
  role: string;
  content: string;
  timestamp?: Date | string | null;
  kind?: string | null;
  emotion?: string | null;
  speaker?: string | null;
  act?: string | null;
}

export interface FingerprintPeriod {
  id: string;
  from: string;
  to: string;
}

export interface StyleFingerprintCore {
  samples: number;
  /** Per-bubble code-point length. histogram[i] is exactly i chars; last bin is 60+. */
  length: { median: number; p90: number; p95: number; histogram: number[] };
  /** Total code points of one turn (a burst). */
  turnChars: { median: number; p95: number };
  /** How the line ends. Eight classes, summing to 1. */
  endings: Record<EndingClass, number>;
  /** Last particle after trailing marks are stripped. Includes "none". */
  particles: Record<string, number>;
  punctuation: {
    commaPerChar: number;
    /** Of lines with two or more clauses, the share that break on spaces not commas. */
    spaceAsComma: number;
    ellipsisForms: { unicode: number; dots: number; cjkDots: number };
    exclaimRuns: number[];
    questionRuns: number[];
    halfWidthRate: number;
    /** How many `？！，?!,` were counted. B3.4 needs a floor of 30. */
    markCount: number;
  };
  laugh: { rate: number; forms: Record<string, number>; haRuns: number[] };
  reduplication: Record<string, number>;
  emoji: { rate: number; perLine: number; top: Array<[string, number]> };
  kaomoji: { rate: number };
  latin: { rate: number; abbreviations: Record<string, number> };
  typoFix: { starRate: number };
  script: { traditionalRate: number };
  address: Record<string, number>;
}

export interface StyleFingerprint extends StyleFingerprintCore {
  /** Filled by B3.2. */
  surpriseP75?: number;
  /** Filled by B9.3 when there are at least 1000 lines. */
  never?: string[];
  perState?: Partial<Record<EmotionalState, StyleFingerprintCore>>;
  perPeriod?: Record<string, StyleFingerprintCore>;
}

export interface FingerprintMeasureOptions {
  addressForms?: string[];
  periods?: FingerprintPeriod[];
  /** Whose text to measure. Defaults to the persona. */
  role?: "assistant" | "user";
}

function codePoints(text: string): number {
  return Array.from(text).length;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function zeroEndings(): Record<EndingClass, number> {
  return {
    period: 0,
    ellipsis: 0,
    question: 0,
    exclaim: 0,
    tilde: 0,
    emoji: 0,
    particle: 0,
    other: 0,
  };
}

function emptyHaRuns(): number[] {
  return Array.from({ length: HA_RUN_MAX + 1 }, () => 0);
}

function emptyMarkRuns(): number[] {
  return Array.from({ length: MARK_RUN_MAX }, () => 0);
}

function emptyLengthHistogram(): number[] {
  return Array.from({ length: LENGTH_HIST_MAX + 1 }, () => 0);
}

function lastChar(text: string): string {
  const chars = Array.from(text);
  return chars[chars.length - 1] ?? "";
}

function isEmojiChar(char: string): boolean {
  return char.length > 0 && EMOJI_RE.test(char);
}

/**
 * Which of the eight ending classes a line falls into.
 *
 * Ellipsis is decided before a single period, so "好的。。。" is not a
 * period line.
 */
export function endingClassOf(line: string): EndingClass {
  const chars = Array.from(line.trimEnd());
  if (chars.length === 0) return "other";

  const takeWhile = (pred: (char: string) => boolean): string[] => {
    const taken: string[] = [];
    for (let i = chars.length - 1; i >= 0; i--) {
      if (!pred(chars[i]!)) break;
      taken.push(chars[i]!);
    }
    return taken.reverse();
  };

  const dots = takeWhile((char) => char === ".");
  const ideographic = takeWhile((char) => char === "。");
  const ellipsisMarks = takeWhile((char) => char === "…" || char === "⋯");
  if (ellipsisMarks.length >= 1 || dots.length >= 3 || ideographic.length >= 2) {
    return "ellipsis";
  }
  const end = chars[chars.length - 1]!;
  if (end === "。" || end === "." || end === "．") return "period";
  if (end === "？" || end === "?") return "question";
  if (end === "！" || end === "!") return "exclaim";
  if (end === "～" || end === "~") return "tilde";
  if (isEmojiChar(end)) return "emoji";
  if (PARTICLE_SET.has(end)) return "particle";
  return "other";
}

/**
 * The last particle still standing after trailing marks are peeled off.
 *
 * Returns `"none"` when the last remaining character is not in the table.
 */
export function lastParticleOf(line: string): string {
  const chars = Array.from(line.trimEnd());
  while (chars.length > 0) {
    const end = chars[chars.length - 1]!;
    if (TRAILING_MARKS.has(end) || /\s/.test(end) || isEmojiChar(end)) {
      chars.pop();
      continue;
    }
    break;
  }
  const end = chars[chars.length - 1];
  return end && PARTICLE_SET.has(end) ? end : "none";
}

function isRoleText(row: FingerprintRow, role: "assistant" | "user"): boolean {
  const rowRole = row.role ?? role;
  return rowRole === role && isTextRecord(row) && row.content.trim().length > 0;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function periodIdOf(at: Date, periods: FingerprintPeriod[]): string | null {
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]!;
    const from = Date.parse(period.from);
    const to = Date.parse(period.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const last = i === periods.length - 1;
    const time = at.getTime();
    if (time >= from && (last ? time <= to : time < to)) return period.id;
  }
  return null;
}

function clauseKind(line: string): "comma" | "space" | "single" {
  const trimmed = line.trim();
  if (COMMA_RE.test(trimmed)) {
    COMMA_RE.lastIndex = 0;
    const parts = trimmed.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return "comma";
  }
  COMMA_RE.lastIndex = 0;
  const spaced = trimmed.split(/\s+/).filter(Boolean);
  if (spaced.length >= 2) return "space";
  return "single";
}

function isTypoFix(line: string): boolean {
  const chars = Array.from(line.trim());
  if (chars.length === 0 || chars.length > 8) return false;
  return chars[0] === "*" || chars[0] === "＊";
}

function hasTraditional(line: string): boolean {
  for (const char of line) {
    if (TRADITIONAL_SET.has(char)) return true;
  }
  return false;
}

function laughFormsOf(line: string): string[] {
  const found: string[] = [];
  for (const { key, re } of LAUGH_RES) {
    if (re.test(line)) found.push(key);
    re.lastIndex = 0;
  }
  return found;
}

function bumpRun(bins: number[], length: number, max: number): void {
  const capped = Math.min(Math.max(length, 1), max);
  const index = max === HA_RUN_MAX ? capped : capped - 1;
  if (index >= 0 && index < bins.length) bins[index] += 1;
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  return (text.match(global) ?? []).length;
}

function measureCore(
  rows: FingerprintRow[],
  role: "assistant" | "user",
  addressForms: string[],
): StyleFingerprintCore {
  const lines = rows.filter((row) => isRoleText(row, role));
  const samples = lines.length;
  const texts = lines.map((row) => row.content.trim());

  const lengths = texts.map(codePoints);
  const sorted = [...lengths].sort((a, b) => a - b);
  const histogram = emptyLengthHistogram();
  for (const length of lengths) {
    const bin = Math.min(length, LENGTH_HIST_MAX);
    histogram[bin] += 1;
  }

  const turns = toTurns(rows.length > 0 ? rows : lines).filter(
    (turn) => (turn[0]?.role ?? role) === role,
  );
  const turnLengths = turns
    .map((turn) =>
      turn
        .filter((row) => isRoleText(row, role))
        .reduce((sum, row) => sum + codePoints(row.content.trim()), 0),
    )
    .filter((length) => length > 0);
  const sortedTurns = [...turnLengths].sort((a, b) => a - b);

  const endings = zeroEndings();
  const particleCounts: Record<string, number> = { none: 0 };
  for (const particle of PARTICLES) particleCounts[particle] = 0;

  const addressCounts: Record<string, number> = {};
  for (const form of addressForms) addressCounts[form] = 0;

  const redupCounts: Record<string, number> = {};
  for (const key of REDUPLICATION_KEYS) redupCounts[key] = 0;

  const laughFormCounts: Record<string, number> = {};
  for (const { key } of LAUGH_RES) laughFormCounts[key] = 0;

  const abbrCounts: Record<string, number> = {};
  const emojiCounts = new Map<string, number>();
  const haRuns = emptyHaRuns();
  const exclaimRuns = emptyMarkRuns();
  const questionRuns = emptyMarkRuns();

  let laughLines = 0;
  let emojiLines = 0;
  let emojiTotal = 0;
  let kaomojiLines = 0;
  let latinLines = 0;
  let typoLines = 0;
  let traditionalLines = 0;
  let commas = 0;
  let chars = 0;
  let spaceClauses = 0;
  let commaClauses = 0;
  let ellipsisUnicode = 0;
  let ellipsisDots = 0;
  let ellipsisCjk = 0;
  let halfMarks = 0;
  let fullMarks = 0;

  for (const text of texts) {
    chars += codePoints(text);
    endings[endingClassOf(text)] += 1;
    particleCounts[lastParticleOf(text)] =
      (particleCounts[lastParticleOf(text)] ?? 0) + 1;

    const laughs = laughFormsOf(text);
    if (laughs.length > 0) laughLines += 1;
    for (const form of laughs) laughFormCounts[form] = (laughFormCounts[form] ?? 0) + 1;

    for (const run of text.match(HA_RUN_RE) ?? []) {
      bumpRun(haRuns, codePoints(run), HA_RUN_MAX);
    }
    HA_RUN_RE.lastIndex = 0;

    for (const run of text.match(EXCLAIM_RUN_RE) ?? []) {
      bumpRun(exclaimRuns, codePoints(run), MARK_RUN_MAX);
    }
    EXCLAIM_RUN_RE.lastIndex = 0;
    for (const run of text.match(QUESTION_RUN_RE) ?? []) {
      bumpRun(questionRuns, codePoints(run), MARK_RUN_MAX);
    }
    QUESTION_RUN_RE.lastIndex = 0;

    const emojis = text.match(EMOJI_ALL_RE) ?? [];
    EMOJI_ALL_RE.lastIndex = 0;
    if (emojis.length > 0) {
      emojiLines += 1;
      emojiTotal += emojis.length;
      for (const emoji of emojis) {
        emojiCounts.set(emoji, (emojiCounts.get(emoji) ?? 0) + 1);
      }
    }

    if (KAOMOJI_RE.test(text)) kaomojiLines += 1;
    if (LATIN_RE.test(text)) latinLines += 1;
    if (isTypoFix(text)) typoLines += 1;
    if (hasTraditional(text)) traditionalLines += 1;

    commas += countMatches(text, COMMA_RE);
    ellipsisUnicode += countMatches(text, ELLIPSIS_UNICODE_RE);
    ellipsisDots += countMatches(text, ELLIPSIS_DOTS_RE);
    ellipsisCjk += countMatches(text, ELLIPSIS_CJK_RE);
    halfMarks += countMatches(text, HALF_MARK_RE);
    fullMarks += countMatches(text, FULL_MARK_RE);

    const clause = clauseKind(text);
    if (clause === "space") spaceClauses += 1;
    if (clause === "comma") commaClauses += 1;

    for (const key of REDUPLICATION_KEYS) {
      if (new RegExp(`${key}{2,}`, "u").test(text)) redupCounts[key] += 1;
    }
    for (const form of addressForms) {
      if (form && text.includes(form)) addressCounts[form] += 1;
    }
    for (const token of text.match(LATIN_ABBR_RE) ?? []) {
      const key = token.toLowerCase();
      abbrCounts[key] = (abbrCounts[key] ?? 0) + 1;
    }
    LATIN_ABBR_RE.lastIndex = 0;
  }

  const asRate = (count: number): number => (samples === 0 ? 0 : count / samples);
  const endingRates = zeroEndings();
  for (const key of ENDING_CLASSES) endingRates[key] = asRate(endings[key]);

  const particleRates: Record<string, number> = {};
  for (const [key, count] of Object.entries(particleCounts)) {
    particleRates[key] = asRate(count);
  }

  const laughFormRates: Record<string, number> = {};
  for (const [key, count] of Object.entries(laughFormCounts)) {
    laughFormRates[key] = asRate(count);
  }

  const redupRates: Record<string, number> = {};
  for (const [key, count] of Object.entries(redupCounts)) {
    redupRates[key] = asRate(count);
  }

  const addressRates: Record<string, number> = {};
  for (const [key, count] of Object.entries(addressCounts)) {
    addressRates[key] = asRate(count);
  }

  const abbrRates: Record<string, number> = {};
  for (const [key, count] of Object.entries(abbrCounts)) {
    abbrRates[key] = asRate(count);
  }

  const top = [...emojiCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10) as Array<[string, number]>;

  const clauseTotal = spaceClauses + commaClauses;
  const markTotal = halfMarks + fullMarks;

  return {
    samples,
    length: {
      median: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      p95: quantile(sorted, 0.95),
      histogram,
    },
    turnChars: {
      median: quantile(sortedTurns, 0.5),
      p95: quantile(sortedTurns, 0.95),
    },
    endings: endingRates,
    particles: particleRates,
    punctuation: {
      commaPerChar: chars === 0 ? 0 : commas / chars,
      spaceAsComma: clauseTotal === 0 ? 0 : spaceClauses / clauseTotal,
      ellipsisForms: {
        unicode: ellipsisUnicode,
        dots: ellipsisDots,
        cjkDots: ellipsisCjk,
      },
      exclaimRuns,
      questionRuns,
      halfWidthRate: markTotal === 0 ? 0 : halfMarks / markTotal,
      markCount: markTotal,
    },
    laugh: { rate: asRate(laughLines), forms: laughFormRates, haRuns },
    reduplication: redupRates,
    emoji: { rate: asRate(emojiLines), perLine: asRate(emojiTotal), top },
    kaomoji: { rate: asRate(kaomojiLines) },
    latin: { rate: asRate(latinLines), abbreviations: abbrRates },
    typoFix: { starRate: asRate(typoLines) },
    script: { traditionalRate: asRate(traditionalLines) },
    address: addressRates,
  };
}

/**
 * Measures the writing habits of one side of the record.
 *
 * Fewer than forty text bubbles is not a fingerprint.
 */
export function measureFingerprint(
  rows: FingerprintRow[],
  options?: FingerprintMeasureOptions,
): StyleFingerprint | null {
  const role = options?.role ?? "assistant";
  const addressForms = [...new Set((options?.addressForms ?? []).map((form) => form.trim()).filter(Boolean))];
  const lines = rows.filter((row) => isRoleText(row, role));
  if (lines.length < MIN_FINGERPRINT_SAMPLES) return null;

  const core = measureCore(rows, role, addressForms);
  const fingerprint: StyleFingerprint = { ...core };

  const byState = new Map<EmotionalState, FingerprintRow[]>();
  for (const row of lines) {
    if (!isEmotionalState(row.emotion)) continue;
    const list = byState.get(row.emotion) ?? [];
    list.push(row);
    byState.set(row.emotion, list);
  }
  const perState: Partial<Record<EmotionalState, StyleFingerprintCore>> = {};
  for (const [state, group] of byState) {
    if (group.length < MIN_FINGERPRINT_STATE_SAMPLES) continue;
    perState[state] = measureCore(group, role, addressForms);
  }
  if (Object.keys(perState).length > 0) fingerprint.perState = perState;

  const periods = options?.periods ?? [];
  if (periods.length > 0) {
    const byPeriod = new Map<string, FingerprintRow[]>();
    for (const row of lines) {
      const at = asDate(row.timestamp);
      if (!at) continue;
      const id = periodIdOf(at, periods);
      if (!id) continue;
      const list = byPeriod.get(id) ?? [];
      list.push(row);
      byPeriod.set(id, list);
    }
    const perPeriod: Record<string, StyleFingerprintCore> = {};
    for (const [id, group] of byPeriod) {
      if (group.length < MIN_FINGERPRINT_PERIOD_SAMPLES) continue;
      perPeriod[id] = measureCore(group, role, addressForms);
    }
    if (Object.keys(perPeriod).length > 0) fingerprint.perPeriod = perPeriod;
  }

  const surprises = lines
    .map((row) => lineSurprise(row.content, core))
    .sort((a, b) => a - b);
  fingerprint.surpriseP75 = quantile(surprises, 0.75);

  return fingerprint;
}

export type FingerprintHighlightId = "almostNoPeriod" | "laughFourHa" | "topParticles";

export interface FingerprintHighlight {
  id: FingerprintHighlightId;
  rate?: number;
  particles?: string[];
}

const ALMOST_NO_PERIOD = 0.15;
const LAUGH_RATE_MIN = 0.02;
const PARTICLE_PROMINENT = 0.08;
const PARTICLE_LEAD = 0.15;

/**
 * The handful of claims the panel is willing to print.
 *
 * A class that is rare, or a sample that is thin, is left off rather
 * than rendered as a "not enough" line.
 */
export function fingerprintHighlights(fp: StyleFingerprint): FingerprintHighlight[] {
  const out: FingerprintHighlight[] = [];
  if (fp.samples >= MIN_FINGERPRINT_SAMPLES && fp.endings.period <= ALMOST_NO_PERIOD) {
    out.push({ id: "almostNoPeriod", rate: fp.endings.period });
  }
  const haRuns = fp.laugh.haRuns;
  const four = haRuns[4] ?? 0;
  const peak = Math.max(0, ...haRuns.slice(2));
  if (
    fp.samples >= MIN_FINGERPRINT_SAMPLES &&
    fp.laugh.rate >= LAUGH_RATE_MIN &&
    four > 0 &&
    four === peak
  ) {
    out.push({ id: "laughFourHa" });
  }
  const ranked = Object.entries(fp.particles)
    .filter(([key, rate]) => key !== "none" && rate >= PARTICLE_PROMINENT)
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length > 0 && (ranked[0]?.[1] ?? 0) >= PARTICLE_LEAD) {
    out.push({
      id: "topParticles",
      particles: ranked.slice(0, 3).map(([key]) => key),
    });
  }
  return out;
}

export function defaultAddressForms(): string[] {
  return [...ADDRESS_WORDS_ZH, ...ADDRESS_WORDS_EN];
}

export interface StyleDistance {
  total: number;
  endings: number;
  particles: number;
  laugh: number;
  emoji: number;
  length: number;
}

const DIST_SMOOTH = 0.01;

/** 1-Wasserstein distance between two histograms on the same bins. */
function wassersteinHist(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i] ?? 0;
    sumB += b[i] ?? 0;
  }
  if (sumA === 0 || sumB === 0) return 0;
  let cdfA = 0;
  let cdfB = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    cdfA += (a[i] ?? 0) / sumA;
    cdfB += (b[i] ?? 0) / sumB;
    total += Math.abs(cdfA - cdfB);
  }
  return total;
}

function lengthHistogramOf(lengths: number[]): number[] {
  const histogram = emptyLengthHistogram();
  for (const length of lengths) {
    histogram[Math.min(length, LENGTH_HIST_MAX)] += 1;
  }
  return histogram;
}

function smoothDist(dist: Record<string, number>, keys: string[]): number[] {
  const raw = keys.map((key) => (dist[key] ?? 0) + DIST_SMOOTH);
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((value) => value / sum);
}

function kl(p: number[], q: number[]): number {
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i]! > 0) sum += p[i]! * Math.log(p[i]! / q[i]!);
  }
  return sum;
}

function jsdNormalized(p: number[], q: number[]): number {
  const m = p.map((pi, i) => 0.5 * (pi + q[i]!));
  return (0.5 * kl(p, m) + 0.5 * kl(q, m)) / Math.LN2;
}

function ratesFromCounts(counts: Record<string, number>, total: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    out[key] = total === 0 ? 0 : value / total;
  }
  return out;
}

function generatedStats(lines: string[]): {
  samples: number;
  endings: Record<EndingClass, number>;
  particles: Record<string, number>;
  laughRate: number;
  laughCount: number;
  haRuns: number[];
  emojiRate: number;
  lengths: number[];
} {
  const endings = zeroEndings();
  const particleCounts: Record<string, number> = { none: 0 };
  for (const particle of PARTICLES) particleCounts[particle] = 0;
  const haRuns = emptyHaRuns();
  let laughCount = 0;
  let emojiCount = 0;
  const lengths: number[] = [];
  for (const raw of lines) {
    const text = raw.trim();
    if (!text) continue;
    lengths.push(codePoints(text));
    endings[endingClassOf(text)] += 1;
    particleCounts[lastParticleOf(text)] = (particleCounts[lastParticleOf(text)] ?? 0) + 1;
    if (laughFormsOf(text).length > 0) laughCount += 1;
    for (const run of text.match(HA_RUN_RE) ?? []) {
      bumpRun(haRuns, codePoints(run), HA_RUN_MAX);
    }
    HA_RUN_RE.lastIndex = 0;
    const emojis = text.match(EMOJI_ALL_RE) ?? [];
    EMOJI_ALL_RE.lastIndex = 0;
    if (emojis.length > 0) emojiCount += 1;
  }
  const samples = lengths.length;
  return {
    samples,
    endings: ratesFromCounts(endings, samples) as Record<EndingClass, number>,
    particles: ratesFromCounts(particleCounts, samples),
    laughRate: samples === 0 ? 0 : laughCount / samples,
    laughCount,
    haRuns,
    emojiRate: samples === 0 ? 0 : emojiCount / samples,
    lengths,
  };
}

function haRunDist(runs: number[]): Record<string, number> {
  const total = runs.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  for (let i = 0; i < runs.length; i++) {
    out[String(i)] = total === 0 ? 0 : (runs[i] ?? 0) / total;
  }
  return out;
}

/**
 * How far a batch of generated lines sits from a fingerprint.
 *
 * Each term is 0–1. Smaller is closer.
 */
export function styleDistance(lines: string[], fp: StyleFingerprintCore): StyleDistance {
  const gen = generatedStats(lines);
  if (gen.samples === 0) {
    return { total: 0, endings: 0, particles: 0, laugh: 0, emoji: 0, length: 0 };
  }

  const endingKeys = [...ENDING_CLASSES];
  const endings = jsdNormalized(smoothDist(gen.endings, endingKeys), smoothDist(fp.endings, endingKeys));

  const particleKeys = [...new Set([...Object.keys(fp.particles), ...Object.keys(gen.particles)])];
  const particles = jsdNormalized(
    smoothDist(gen.particles, particleKeys),
    smoothDist(fp.particles, particleKeys),
  );

  const laughRateGap = Math.abs(gen.laughRate - fp.laugh.rate);
  const fpLaughCount = fp.laugh.rate * fp.samples;
  const haKeys = Array.from({ length: HA_RUN_MAX + 1 }, (_, i) => String(i));
  const laugh =
    gen.laughCount < 3 || fpLaughCount < 3
      ? Math.min(1, laughRateGap)
      : Math.min(
          1,
          laughRateGap +
            0.5 *
              jsdNormalized(
                smoothDist(haRunDist(gen.haRuns), haKeys),
                smoothDist(haRunDist(fp.laugh.haRuns), haKeys),
              ),
        );

  const emojiDenom = Math.max(0.05, fp.emoji.rate);
  const emoji = Math.min(1, Math.abs(gen.emojiRate - fp.emoji.rate) / emojiDenom);

  const lengthRaw =
    wassersteinHist(fp.length.histogram, lengthHistogramOf(gen.lengths)) /
    Math.max(1, fp.length.median);
  const length = Math.min(1, lengthRaw);

  const total = (endings + particles + laugh + emoji + length) / 5;
  return { total, endings, particles, laugh, emoji, length };
}

/**
 * How unexpected one line is under a fingerprint.
 *
 * Used by rerank and the drift ruler. Probabilities are smoothed by 0.01.
 */
export function lineSurprise(line: string, fp: StyleFingerprintCore): number {
  const text = line.trim();
  const ending = endingClassOf(text);
  const particle = lastParticleOf(text);
  const pEnding = (fp.endings[ending] ?? 0) + DIST_SMOOTH;
  const pParticle = (fp.particles[particle] ?? 0) + DIST_SMOOTH;
  const chars = codePoints(text);
  const spread = lengthSpread(fp.length);
  return -Math.log(pEnding) - Math.log(pParticle) + Math.abs(chars - fp.length.median) / spread;
}

/**
 * How far a length may sit from the median before it is unusual.
 *
 * p90 − median is zero when the mass of the histogram sits on the
 * median itself (the fixture clamps lines at 10). A one-character
 * "嗯" then looks nine times further away than it is. The lower tail
 * is the scale in that case.
 */
function lengthSpread(length: { median: number; p90: number; histogram?: number[] }): number {
  const upper = Math.max(0, length.p90 - length.median);
  let lower = 0;
  const hist = length.histogram;
  if (hist && hist.length > 0) {
    let total = 0;
    for (const count of hist) total += count;
    if (total > 0) {
      const target = total * 0.1;
      let seen = 0;
      let p10 = 0;
      for (let bin = 0; bin < hist.length; bin++) {
        seen += hist[bin] ?? 0;
        if (seen >= target) {
          p10 = bin;
          break;
        }
      }
      lower = Math.max(0, length.median - p10);
    }
  }
  return Math.max(1, upper, lower);
}
