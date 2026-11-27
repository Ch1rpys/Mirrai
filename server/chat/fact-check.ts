/**
 * Whether a reply named something the records actually hold.
 *
 * Dates, places, and old days are the claims that sound like memory.
 * A question is not a claim. Coverage is character-bigram overlap
 * against this turn's memories, then a lexical scan of the records.
 */
import * as db from "../db";
import { charBigrams } from "@shared/act-clusters";
import type { Locale } from "@shared/copy";

export const CLAIM_COVERAGE_MIN = 0.5;

export interface Claim {
  text: string;
  kind: "date" | "place" | "event";
  start: number;
  end: number;
}

export interface ClaimMemory {
  id: number;
  title: string;
  description?: string | null;
  date?: string | null;
}

export interface ClaimRecord {
  id: number;
  content: string;
  timestamp?: Date | string | null;
}

export interface ClaimSource {
  type: "memory" | "record";
  id: number;
  at?: string;
}

export type VerifiedClaim = Claim & {
  supported: boolean;
  source?: ClaimSource;
};

export interface VerifyClaimsContext {
  personaId: number;
  userId: number;
  memories: ClaimMemory[];
  /**
   * Rows already in hand. Tests pass the fixture here so they do not
   * need a database. Production leaves this off and scans the table.
   */
  records?: ClaimRecord[];
}

/** How much of the claim's character bigrams sit in the haystack. */
export function claimCoverage(claim: string, haystack: string): number {
  const left = charBigrams(claim);
  if (left.size === 0) return 0;
  const right = charBigrams(haystack);
  let hits = 0;
  for (const gram of left) if (right.has(gram)) hits += 1;
  return hits / left.size;
}

function memoryHaystack(memory: ClaimMemory): string {
  return `${memory.title ?? ""} ${memory.description ?? ""}`;
}

function atOf(value: Date | string | null | undefined): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    const day = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return day ? day[1] : value;
  }
  if (Number.isNaN(value.getTime())) return undefined;
  return value.toISOString().slice(0, 10);
}

function hasHan(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function hasLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

/**
 * Whether the clause asks something.
 *
 * The punctuation that ended the clause is the strongest mark, and it is
 * passed separately because `splitClauses` cuts on it: 「你昨天去拾光
 * 咖啡了？」 has been split into 「你昨天去拾光咖啡了」 before this is
 * asked, so looking for the mark inside the clause found nothing. The
 * line read as a statement and the place became a claim the reply had
 * to have in the record.
 *
 * The mark is also what covers an inverted sentence the words below do
 * not recognise ("You went to the Blue Lake Cafe?") and the trailing
 * closing quote the split leaves behind.
 */
// i18n:allow-input — particles that mark a question in what they typed
function isQuestionClause(clause: string, locale: Locale, endedBy: string): boolean {
  if (/[？?]/.test(endedBy)) return true;
  const trimmed = clause.replace(/[。！!…\s]+$/g, "");
  if (trimmed.endsWith("吗") || clause.includes("是不是")) return true;
  if (locale === "en" || hasLatin(trimmed)) {
    return /^(did|do|does|is|are|were|was|have|has|had|can|could|would|will)\b/i.test(
      trimmed,
    );
  }
  return false;
}

function splitClauses(
  reply: string,
): Array<{ text: string; start: number; endedBy: string }> {
  const source = String(reply ?? "");
  if (!source) return [];
  const out: Array<{ text: string; start: number; endedBy: string }> = [];
  const re = /[。！？!?；;\n]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const text = source.slice(last, match.index);
    if (text.trim()) out.push({ text, start: last, endedBy: match[0] });
    last = match.index + match[0].length;
  }
  const tail = source.slice(last);
  if (tail.trim()) out.push({ text: tail, start: last, endedBy: "" });
  return out;
}

function pushClaim(out: Claim[], claim: Claim) {
  if (!claim.text.trim()) return;
  if (out.some((row) => row.kind === claim.kind && row.text === claim.text)) return;
  out.push(claim);
}

/**
 * Dates, places, and old days named in a statement.
 *
 * i18n:allow-input — matched against what they said, not copy the app writes.
 */
const DATE_RES: RegExp[] = [
  /\d+月\d+[日号]/g,
  /\d{4}年/g,
  /(?:去年|前年|上个月|上周)[^\s。！？!?，,]{0,24}/g,
];

const EN_DATE_RES: RegExp[] = [
  /\b(?:last year|last month|last week)\b[\s\S]{0,24}/gi,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/gi,
];

// i18n:allow-input — place-name endings in the records, including 咖啡
const PLACE_SUFFIXES = [
  "公园",
  "广场",
  "学校",
  "医院",
  "机场",
  "车站",
  "咖啡",
  "店",
  "馆",
  "路",
  "街",
];
// i18n:allow-input — function words that sit in front of a place name, not inside it
const PLACE_STOP = new Set(Array.from("我你他她们的了在到从去和与喝吃过来吧呢啊呀嘛是不没很也就都还又把被让给对想要这那个过吗"));
const QUOTED_RE = /[「『“"]([^」』”"]{1,12})[」』”"]/g;
const EVENT_RE = /上次|那次|那天|那年|第一次|还记得/g;
const EN_EVENT_RE = /\b(?:last time|that time|that day|the first time|remember when)\b/gi;
// i18n:allow-input — place-name endings in English lines, not copy
const EN_PLACE_SUFFIXES = [
  "cafe",
  "café",
  "street",
  "road",
  "park",
  "school",
  "hospital",
  "airport",
  "station",
  "restaurant",
];
// i18n:allow-input — determiners that can start a place name, and stop the walk
const EN_DETERMINERS = new Set([
  "the",
  "a",
  "an",
  "that",
  "this",
  "these",
  "those",
  "my",
  "your",
  "his",
  "her",
  "their",
  "our",
  "its",
]);
// i18n:allow-input — English words that sit in front of a place name, not inside it
const EN_PLACE_STOP = new Set([
  "in",
  "on",
  "at",
  "to",
  "from",
  "by",
  "with",
  "for",
  "of",
  "and",
  "or",
  "but",
  "was",
  "were",
  "is",
  "are",
  "am",
  "be",
  "been",
  "being",
  "go",
  "went",
  "gone",
  "walk",
  "walked",
  "run",
  "ran",
  "drive",
  "drove",
  "take",
  "took",
  "get",
  "got",
  "meet",
  "met",
  "see",
  "saw",
  "visit",
  "visited",
  "stay",
  "stayed",
  "live",
  "lives",
  "lived",
  "work",
  "works",
  "worked",
  "study",
  "studied",
  "eat",
  "ate",
  "drink",
  "drank",
  "buy",
  "bought",
  "leave",
  "left",
  "return",
  "returned",
  "came",
  "come",
  "arrive",
  "arrived",
  "move",
  "moved",
  "pass",
  "passed",
  "stop",
  "stopped",
  "wait",
  "waited",
  "look",
  "looked",
  "find",
  "found",
  "spend",
  "spent",
  "us",
  "me",
  "him",
  "them",
  "you",
  "we",
  "i",
  "he",
  "she",
  "they",
  "it",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractDates(clause: string, start: number, locale: Locale): Claim[] {
  const patterns = [
    ...(locale === "zh" || hasHan(clause) ? DATE_RES : []),
    ...(locale === "en" || hasLatin(clause) ? EN_DATE_RES : []),
  ];
  const out: Claim[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(clause))) {
      const text = match[0]!.trim();
      if (!text) continue;
      pushClaim(out, {
        text,
        kind: "date",
        start: start + match.index,
        end: start + match.index + match[0]!.length,
      });
    }
  }
  return out;
}

function placeFromSuffix(clause: string, suffixAt: number, suffix: string): string | null {
  const end = suffixAt + suffix.length;
  let begin = end - suffix.length;
  while (begin > 0 && end - (begin - 1) <= 8) {
    const prev = clause.charAt(begin - 1);
    if (!/^[\u4e00-\u9fff]$/.test(prev) || PLACE_STOP.has(prev)) break;
    begin -= 1;
  }
  const text = clause.slice(begin, end);
  if (text.length < 2 || text.length > 8) return null;
  if (!/^[\u4e00-\u9fff]+$/.test(text)) return null;
  if (!text.endsWith(suffix)) return null;
  // 「咖啡」by itself is the drink. A place needs a name in front of it.
  if (suffix.length >= 2 && text === suffix) return null;
  return text;
}

/**
 * The place phrase, not the sentence that led to it.
 *
 * The old regex took up to three words before the suffix, so
 * «He works at the hospital» became one place claim. Walk back from
 * the suffix, stop at a verb or a preposition, and let a determiner
 * in only as the first word («the park»).
 */
function placeFromEnglishSuffix(
  clause: string,
  suffixAt: number,
  suffix: string,
): { text: string; start: number } | null {
  const end = suffixAt + suffix.length;
  let start = suffixAt;
  let cursor = suffixAt;
  let words = 0;
  while (cursor > 0 && words < 4) {
    let index = cursor - 1;
    while (index >= 0 && /\s/.test(clause.charAt(index))) index--;
    if (index < 0) break;
    if (!/[A-Za-z'’\-]/.test(clause.charAt(index))) break;
    let wordStart = index;
    while (wordStart >= 0 && /[A-Za-z'’\-]/.test(clause.charAt(wordStart))) wordStart--;
    const word = clause.slice(wordStart + 1, index + 1);
    const lower = word.toLowerCase();
    if (EN_PLACE_STOP.has(lower)) break;
    const determiner = EN_DETERMINERS.has(lower);
    start = wordStart + 1;
    cursor = wordStart + 1;
    words += 1;
    if (determiner) break;
  }
  const text = clause.slice(start, end).trim();
  if (text.length < 2 || !/[A-Za-z]/.test(text)) return null;
  return { text, start };
}

function extractEnglishPlaces(clause: string, start: number): Claim[] {
  const out: Claim[] = [];
  const pattern = new RegExp(`(?:${EN_PLACE_SUFFIXES.map(escapeRegExp).join("|")})(?![A-Za-z])`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clause))) {
    if (match.index > 0 && /[A-Za-z]/.test(clause.charAt(match.index - 1))) continue;
    const place = placeFromEnglishSuffix(clause, match.index, match[0]);
    if (!place) continue;
    pushClaim(out, {
      text: place.text,
      kind: "place",
      start: start + place.start,
      end: start + match.index + match[0].length,
    });
  }
  return out;
}

function extractPlaces(clause: string, start: number, locale: Locale): Claim[] {
  const out: Claim[] = [];
  QUOTED_RE.lastIndex = 0;
  let quoted: RegExpExecArray | null;
  while ((quoted = QUOTED_RE.exec(clause))) {
    const text = quoted[1]!.trim();
    if (text.length < 2) continue;
    pushClaim(out, {
      text,
      kind: "place",
      start: start + quoted.index + (quoted[0]!.length - quoted[1]!.length - 1),
      end: start + quoted.index + quoted[0]!.length - 1,
    });
  }
  if (locale === "zh" || hasHan(clause)) {
    for (const suffix of PLACE_SUFFIXES) {
      let from = 0;
      while (from < clause.length) {
        const at = clause.indexOf(suffix, from);
        if (at < 0) break;
        const text = placeFromSuffix(clause, at, suffix);
        if (text) {
          const end = at + suffix.length;
          pushClaim(out, {
            text,
            kind: "place",
            start: start + end - text.length,
            end: start + end,
          });
        }
        from = at + 1;
      }
    }
  }
  if (locale === "en" || hasLatin(clause)) {
    for (const claim of extractEnglishPlaces(clause, start)) pushClaim(out, claim);
  }
  return out.filter((claim, _, all) =>
    !all.some((other) => other !== claim && other.kind === "place" && other.text.includes(claim.text) && other.text !== claim.text),
  );
}

function extractEvents(clause: string, start: number, locale: Locale): Claim[] {
  const patterns = [
    ...(locale === "zh" || hasHan(clause) ? [EVENT_RE] : []),
    ...(locale === "en" || hasLatin(clause) ? [EN_EVENT_RE] : []),
  ];
  let earliest: RegExpExecArray | null = null;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(clause);
    if (!match) continue;
    if (!earliest || match.index < earliest.index) earliest = match;
  }
  if (!earliest) return [];
  const text = clause.slice(earliest.index).trim();
  if (!text) return [];
  return [
    {
      text,
      kind: "event",
      start: start + earliest.index,
      end: start + clause.length,
    },
  ];
}

export function extractClaims(reply: string, locale: Locale): Claim[] {
  const out: Claim[] = [];
  for (const clause of splitClauses(reply)) {
    if (isQuestionClause(clause.text, locale, clause.endedBy)) continue;
    for (const claim of extractDates(clause.text, clause.start, locale)) pushClaim(out, claim);
    for (const claim of extractPlaces(clause.text, clause.start, locale)) pushClaim(out, claim);
    for (const claim of extractEvents(clause.text, clause.start, locale)) pushClaim(out, claim);
  }
  return out;
}

function supportFromMemory(claim: Claim, memories: ClaimMemory[]): ClaimSource | undefined {
  let best: { memory: ClaimMemory; coverage: number } | undefined;
  for (const memory of memories) {
    const coverage = claimCoverage(claim.text, memoryHaystack(memory));
    if (coverage < CLAIM_COVERAGE_MIN) continue;
    if (!best || coverage > best.coverage) best = { memory, coverage };
  }
  if (!best) return undefined;
  const at = atOf(best.memory.date);
  return {
    type: "memory",
    id: best.memory.id,
    ...(at ? { at } : {}),
  };
}

function supportFromRows(claim: Claim, rows: ClaimRecord[]): ClaimSource | undefined {
  let best: { row: ClaimRecord; coverage: number } | undefined;
  for (const row of rows) {
    const text = String(row.content ?? "");
    if (!text) continue;
    const coverage = claimCoverage(claim.text, text);
    const hit = coverage >= CLAIM_COVERAGE_MIN || text.includes(claim.text);
    if (!hit) continue;
    const score = Math.max(coverage, text.includes(claim.text) ? 1 : coverage);
    if (!best || score > best.coverage) best = { row, coverage: score };
  }
  if (!best) return undefined;
  const at = atOf(best.row.timestamp);
  return {
    type: "record",
    id: best.row.id,
    ...(at ? { at } : {}),
  };
}

async function supportFromTable(
  claim: Claim,
  ctx: VerifyClaimsContext,
): Promise<ClaimSource | undefined> {
  try {
    if (typeof db.searchRecordsLexical !== "function") return undefined;
    const hits = await db.searchRecordsLexical(ctx.personaId, ctx.userId, {
      q: claim.text,
      limit: 8,
    });
    const first = hits[0];
    if (!first) return undefined;
    const at = atOf(first.timestamp);
    return {
      type: "record",
      id: first.id,
      ...(at ? { at } : {}),
    };
  } catch {
    return undefined;
  }
}

export async function verifyClaims(
  claims: Claim[],
  ctx: VerifyClaimsContext,
): Promise<VerifiedClaim[]> {
  const out: VerifiedClaim[] = [];
  for (const claim of claims) {
    const fromMemory = supportFromMemory(claim, ctx.memories);
    if (fromMemory) {
      out.push({ ...claim, supported: true, source: fromMemory });
      continue;
    }
    const fromRows = ctx.records
      ? supportFromRows(claim, ctx.records)
      : await supportFromTable(claim, ctx);
    if (fromRows) {
      out.push({ ...claim, supported: true, source: fromRows });
      continue;
    }
    out.push({ ...claim, supported: false });
  }
  return out;
}

export async function hasUnsupportedClaim(
  reply: string,
  ctx: VerifyClaimsContext,
  locale: Locale,
): Promise<boolean> {
  const claims = extractClaims(reply, locale);
  if (claims.length === 0) return false;
  const verified = await verifyClaims(claims, ctx);
  return verified.some((row) => !row.supported);
}
