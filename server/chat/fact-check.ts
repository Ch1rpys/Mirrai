/**
 * Whether a reply named something the records actually hold.
 *
 * Dates, places, and old days are the claims that sound like memory.
 * A question is not a claim. Coverage is character-bigram overlap
 * against this turn's memories, then a lexical scan of the records.
 */
import * as db from "../db";
import { charBigrams } from "@shared/act-clusters";

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

// i18n:allow-input — particles that mark a question in what they typed
function isQuestionClause(clause: string, locale: "zh" | "en"): boolean {
  if (/[？?]/.test(clause)) return true;
  const trimmed = clause.replace(/[。！!…\s]+$/g, "");
  if (locale === "zh") {
    if (trimmed.endsWith("吗")) return true;
    if (clause.includes("是不是")) return true;
    return false;
  }
  return /^(did|do|does|is|are|were|was|have|has|had|can|could|would|will)\b/i.test(
    trimmed,
  );
}

function splitClauses(reply: string): Array<{ text: string; start: number }> {
  const source = String(reply ?? "");
  if (!source) return [];
  const out: Array<{ text: string; start: number }> = [];
  const re = /[。！？!?；;\n]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const text = source.slice(last, match.index);
    if (text.trim()) out.push({ text, start: last });
    last = match.index + match[0].length;
  }
  const tail = source.slice(last);
  if (tail.trim()) out.push({ text: tail, start: last });
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
const PLACE_LEAD = /^(上次|那次|那天|那年|第一次|还记得|去|在|到|从|的|了)+/;
const QUOTED_RE = /[「『“"]([^」』”"]{1,12})[」』”"]/g;
const EVENT_RE = /上次|那次|那天|那年|第一次|还记得/g;
const EN_EVENT_RE = /\b(?:last time|that time|that day|the first time|remember when)\b/gi;
const EN_PLACE_RE = /\b([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,3}\s+(?:cafe|café|street|road|park|school|hospital|airport|station|restaurant))\b/gi;

function extractDates(clause: string, start: number, locale: "zh" | "en"): Claim[] {
  const patterns = locale === "zh" ? DATE_RES : EN_DATE_RES;
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
  const begin = Math.max(0, end - 8);
  let text = clause.slice(begin, end);
  text = text.replace(PLACE_LEAD, "");
  if (text.length < 2 || text.length > 8) return null;
  if (!/^[\u4e00-\u9fff]+$/.test(text)) return null;
  if (!text.endsWith(suffix)) return null;
  return text;
}

function extractPlaces(clause: string, start: number, locale: "zh" | "en"): Claim[] {
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
  if (locale === "zh") {
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
    return out.filter((claim, _, all) =>
      !all.some((other) => other !== claim && other.kind === "place" && other.text.includes(claim.text) && other.text !== claim.text),
    );
  }
  EN_PLACE_RE.lastIndex = 0;
  let en: RegExpExecArray | null;
  while ((en = EN_PLACE_RE.exec(clause))) {
    const text = en[1]!.trim();
    if (!text) continue;
    pushClaim(out, {
      text,
      kind: "place",
      start: start + en.index,
      end: start + en.index + text.length,
    });
  }
  return out;
}

function extractEvents(clause: string, start: number, locale: "zh" | "en"): Claim[] {
  const pattern = locale === "zh" ? EVENT_RE : EN_EVENT_RE;
  pattern.lastIndex = 0;
  const match = pattern.exec(clause);
  if (!match) return [];
  const text = clause.slice(match.index).trim();
  if (!text) return [];
  return [
    {
      text,
      kind: "event",
      start: start + match.index,
      end: start + clause.length,
    },
  ];
}

export function extractClaims(reply: string, locale: "zh" | "en"): Claim[] {
  const out: Claim[] = [];
  for (const clause of splitClauses(reply)) {
    if (isQuestionClause(clause.text, locale)) continue;
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
  locale: "zh" | "en",
): Promise<boolean> {
  const claims = extractClaims(reply, locale);
  if (claims.length === 0) return false;
  const verified = await verifyClaims(claims, ctx);
  return verified.some((row) => !row.supported);
}
