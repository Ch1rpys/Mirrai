/**
 * Private words — nicknames, in-jokes, phrases that only these two use.
 *
 * Everyday language is dropped against a built-in list. What remains is
 * still only a candidate until the user confirms it, and only then does
 * it reach the prompt.
 */
import { COMMON_WORDS_EN } from "./data/common-words-en";
import { COMMON_WORDS_ZH } from "./data/common-words-zh";
import { copy, type Locale } from "./copy";
import { isTextRecord } from "./records";

export const LEXICON_MIN_COUNT = 5;
export const LEXICON_CANDIDATE_CAP = 80;
export const LEXICON_PROMPT_CAP = 12;
export const LEXICON_GLOSS_MAX = 20;

export type LexiconWho = "them" | "me" | "both";

export interface LexiconEvidence {
  at?: string;
  snippet: string;
}

export interface LexiconEntry {
  id: string;
  term: string;
  gloss: string;
  who: LexiconWho;
  count: number;
  firstAt?: string;
  evidence: LexiconEvidence[];
  source: "auto" | "manual";
  verified: boolean;
}

export interface LexiconRow {
  role?: string | null;
  content?: string | null;
  timestamp?: Date | string | null;
  kind?: string | null;
}

export interface LexiconCandidate {
  term: string;
  count: number;
  them: number;
  me: number;
  firstAt?: string;
  examples: LexiconEvidence[];
}

const WHO: readonly LexiconWho[] = ["them", "me", "both"];

const COMMON = new Set<string>([
  ...(COMMON_WORDS_ZH as readonly string[]),
  ...(COMMON_WORDS_EN as readonly string[]).map((word) => word.toLowerCase()),
]);

// i18n:allow-input — particles wrapping a private term, not shown as copy.
const WRAP_CHARS = new Set(
  Array.from("了的着过啊呀呢吧哦哈嗯么嘛咯啦又也都不没很就才还再吗哇欸嘿哼在着"),
);

const CJK_RUN = /[\u4e00-\u9fff]+/g;
const LATIN_WORD = /[A-Za-z]{2,}/g;

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function toEvidence(value: unknown): LexiconEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: LexiconEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const snippet = toText(record.snippet);
    if (!snippet) continue;
    const at = toText(record.at);
    out.push(at ? { at, snippet } : { snippet });
  }
  return out;
}

function toWho(value: unknown): LexiconWho {
  return WHO.includes(value as LexiconWho) ? (value as LexiconWho) : "both";
}

function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function isWho(value: unknown): value is LexiconWho {
  return WHO.includes(value as LexiconWho);
}

export function lexiconRejectedKey(term: string): string {
  return `lexicon:${term}`;
}

export function normalizeLexicon(value: unknown): LexiconEntry[] {
  if (!Array.isArray(value)) return [];
  const out: LexiconEntry[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const term = toText(record.term);
    if (!term || seen.has(term)) return;
    seen.add(term);
    const source = record.source === "manual" ? "manual" : "auto";
    const gloss = toText(record.gloss).slice(0, LEXICON_GLOSS_MAX);
    const entry: LexiconEntry = {
      id: toText(record.id) || `lexicon-${index + 1}`,
      term,
      gloss,
      who: toWho(record.who),
      count: toCount(record.count),
      evidence: toEvidence(record.evidence),
      source,
      verified: source === "manual" ? record.verified !== false : record.verified === true,
    };
    const firstAt = toText(record.firstAt);
    if (firstAt) entry.firstAt = firstAt;
    out.push(entry);
  });
  return out;
}

export function verifiedLexiconForPrompt(entries: LexiconEntry[] | null | undefined): LexiconEntry[] {
  return normalizeLexicon(entries)
    .filter((row) => row.verified && (row.who === "them" || row.who === "both"))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, LEXICON_PROMPT_CAP);
}

export function renderLexicon(entries: LexiconEntry[], locale: Locale = "zh"): string {
  const rows = verifiedLexiconForPrompt(entries);
  if (!rows.length) return "";
  return rows
    .map((row) => copy(locale, "prompt.lexiconLine", { term: row.term, gloss: row.gloss }))
    .join("\n");
}

export function hasPromptLexicon(value: unknown): boolean {
  return verifiedLexiconForPrompt(normalizeLexicon(value)).length > 0;
}

function stampOf(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  const text = String(value).trim();
  return text || undefined;
}

/**
 * Cover common words in a Chinese run so "今天还好今天晚上" does not
 * mint 3–4 character concatenations that drown a real 2-character
 * slang in the top eighty.
 */
function maskCommonSpans(run: string): boolean[] {
  const mask = Array.from({ length: run.length }, () => false);
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= run.length; i++) {
      let blocked = false;
      for (let j = i; j < i + n; j++) {
        if (mask[j]) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      if (!isCommon(run.slice(i, i + n))) continue;
      for (let j = i; j < i + n; j++) mask[j] = true;
    }
  }
  return mask;
}

function termsIn(text: string): string[] {
  const out: string[] = [];
  const runs = text.match(CJK_RUN) ?? [];
  for (const run of runs) {
    const mask = maskCommonSpans(run);
    let i = 0;
    while (i < run.length) {
      if (mask[i]) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < run.length && !mask[j]) j += 1;
      const span = run.slice(i, j);
      for (let n = 2; n <= 4 && n <= span.length; n++) {
        for (let k = 0; k + n <= span.length; k++) {
          out.push(span.slice(k, k + n));
        }
      }
      i = j;
    }
  }
  const latin = text.match(LATIN_WORD) ?? [];
  for (const word of latin) {
    if (!isCommon(word)) out.push(word);
  }
  return out;
}

function isCommon(term: string): boolean {
  return COMMON.has(term) || COMMON.has(term.toLowerCase());
}

function leftoverAfter(longer: string, shorter: string): string {
  const i = longer.indexOf(shorter);
  if (i < 0) return longer;
  return longer.slice(0, i) + longer.slice(i + shorter.length);
}

function isWrapperLeftover(text: string): boolean {
  if (!text) return true;
  if (isCommon(text)) return true;
  return Array.from(text).every((ch) => WRAP_CHARS.has(ch));
}

/**
 * Drop a short fragment when a longer compound accounts for it, and
 * drop a longer wrapper when the extra characters are particles or a
 * common word ("又咕咕了" around "咕咕").
 */
export function dropLexiconFragments(counts: Map<string, number>): string[] {
  const terms = [...counts.keys()].sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
  });
  const kept: string[] = [];
  for (const term of terms) {
    const count = counts.get(term) ?? 0;
    const wrapperOf = kept.find((short) => {
      if (term === short || !term.includes(short)) return false;
      const longCount = count;
      const shortCount = counts.get(short) ?? 0;
      return longCount >= shortCount * 0.8 && isWrapperLeftover(leftoverAfter(term, short));
    });
    if (wrapperOf) continue;
    const fragments = kept.filter((short) => {
      if (term === short || !term.includes(short)) return false;
      const shortCount = counts.get(short) ?? 0;
      return count >= shortCount * 0.8 && !isWrapperLeftover(leftoverAfter(term, short));
    });
    for (const fragment of fragments) {
      const i = kept.indexOf(fragment);
      if (i >= 0) kept.splice(i, 1);
    }
    const insideCompound = kept.some((long) => {
      if (term === long || !long.includes(term)) return false;
      const longCount = counts.get(long) ?? 0;
      return longCount >= count * 0.8 && !isWrapperLeftover(leftoverAfter(long, term));
    });
    if (insideCompound) continue;
    kept.push(term);
  }
  return kept;
}

function whoOf(them: number, me: number): LexiconWho {
  const total = them + me;
  if (total <= 0) return "both";
  if (them / total >= 0.8) return "them";
  if (me / total >= 0.8) return "me";
  return "both";
}

/**
 * Count 2–4 character Chinese n-grams and Latin whole words on both
 * sides of the record, drop everyday language and fragments, and keep
 * the eighty most frequent with two example lines.
 */
export function collectLexiconCandidates(rows: LexiconRow[]): LexiconCandidate[] {
  type Hit = { at?: string; snippet: string; role: string; order: number };
  const hits = new Map<string, Hit[]>();
  let order = 0;
  for (const row of rows) {
    if (!isTextRecord(row)) continue;
    const snippet = String(row.content ?? "").trim();
    if (!snippet) continue;
    const role = row.role === "assistant" || row.role === "user" ? row.role : "other";
    const at = stampOf(row.timestamp);
    const seen = new Set<string>();
    for (const raw of termsIn(snippet)) {
      const term = /[A-Za-z]/.test(raw) ? raw.toLowerCase() : raw;
      if (seen.has(term)) continue;
      seen.add(term);
      const list = hits.get(term) ?? [];
      list.push({ snippet, role, order, ...(at ? { at } : {}) });
      hits.set(term, list);
    }
    order += 1;
  }

  const counts = new Map<string, number>();
  for (const [term, list] of hits) {
    if (list.length < LEXICON_MIN_COUNT) continue;
    if (isCommon(term)) continue;
    counts.set(term, list.length);
  }
  const kept = new Set(dropLexiconFragments(counts));

  const candidates: LexiconCandidate[] = [];
  for (const term of kept) {
    const list = (hits.get(term) ?? []).slice().sort((a, b) => {
      if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1;
      return a.order - b.order;
    });
    const them = list.filter((hit) => hit.role === "assistant").length;
    const me = list.filter((hit) => hit.role === "user").length;
    const examples: LexiconEvidence[] = [];
    for (const hit of list) {
      if (examples.length >= 3) break;
      examples.push(hit.at ? { at: hit.at, snippet: hit.snippet } : { snippet: hit.snippet });
    }
    const first = list[0];
    candidates.push({
      term,
      count: list.length,
      them,
      me,
      examples,
      ...(first?.at ? { firstAt: first.at } : {}),
    });
  }
  candidates.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  return candidates.slice(0, LEXICON_CANDIDATE_CAP);
}

export function lexiconWho(candidate: Pick<LexiconCandidate, "them" | "me">): LexiconWho {
  return whoOf(candidate.them, candidate.me);
}

export function isLexiconWho(value: unknown): value is LexiconWho {
  return isWho(value);
}

/**
 * Confirmed entries survive a re-run. Rejected terms stay gone.
 */
export function mergeLexicon(
  previous: unknown,
  mined: unknown,
  rejectedKeys: string[] = [],
): LexiconEntry[] {
  const confirmed = normalizeLexicon(previous).filter((row) => row.verified);
  const confirmedTerms = new Set(confirmed.map((row) => row.term));
  const rejected = new Set(rejectedKeys);
  const fresh = normalizeLexicon(mined).filter(
    (row) => !confirmedTerms.has(row.term) && !rejected.has(lexiconRejectedKey(row.term)),
  );
  return [...confirmed, ...fresh];
}
