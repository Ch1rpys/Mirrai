/**
 * Topics they have never spoken about.
 *
 * If they have said thousands of lines and never once used a domain's
 * words, while the other person has, that domain is a candidate: they
 * don't explain it, they talk past it. The row stays out of the prompt
 * until it is confirmed.
 */
import { copy, type Locale } from "@shared/copy";
import { isTextRecord, recordText } from "@shared/records";
import {
  normalizeSuppressions,
  type Suppression,
  type SuppressionEvidence,
} from "@shared/suppressions";
import { TOPIC_DOMAINS, domainKeywordHit } from "@shared/topic-domains";

export const KNOWLEDGE_BOUNDARY_MIN_TA = 2000;
export const KNOWLEDGE_BOUNDARY_MIN_USER = 5;

export interface KnowledgeBoundaryRow {
  role?: string | null;
  content?: string | null;
  kind?: string | null;
  meta?: unknown;
  timestamp?: Date | string | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asMeta(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function lineText(row: KnowledgeBoundaryRow): string {
  return recordText({
    kind: row.kind,
    content: String(row.content ?? ""),
    meta: asMeta(row.meta),
  }).trim();
}

function idFor(domainId: string): string {
  return `auto-knowledge-${domainId}`;
}

/**
 * Find domains the other person brings up and they never name.
 *
 * Evidence is the reply they actually gave after a mention — not a
 * guessed explanation. Four mentions is still a coincidence; five,
 * against a large enough corpus of their own lines, is a boundary.
 */
export function mineKnowledgeBoundary(
  rows: KnowledgeBoundaryRow[],
  options: { locale?: Locale; minTaLines?: number; minUserMentions?: number } = {},
): Suppression[] {
  const locale = options.locale ?? "zh";
  const minTa = options.minTaLines ?? KNOWLEDGE_BOUNDARY_MIN_TA;
  const minUser = options.minUserMentions ?? KNOWLEDGE_BOUNDARY_MIN_USER;
  const ordered = [...rows].sort((a, b) => {
    const left = toDate(a.timestamp)?.getTime() ?? 0;
    const right = toDate(b.timestamp)?.getTime() ?? 0;
    return left - right;
  });
  const taLines = ordered.filter(
    (row) => row.role === "assistant" && isTextRecord(row) && lineText(row),
  );
  if (taLines.length < minTa) return [];

  const out: Suppression[] = [];
  for (const domain of TOPIC_DOMAINS) {
    let taHits = 0;
    let userHits = 0;
    const evidence: SuppressionEvidence[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const row = ordered[i]!;
      const text = lineText(row);
      if (!text || !domainKeywordHit(text, domain.keywords)) continue;
      if (row.role === "assistant") {
        taHits += 1;
        continue;
      }
      if (row.role !== "user") continue;
      userHits += 1;
      const reply = ordered.slice(i + 1).find((candidate) => candidate.role === "assistant" && lineText(candidate));
      const snippet = reply ? lineText(reply) : "";
      if (snippet && evidence.length < 3) {
        const at = toDate(reply?.timestamp);
        evidence.push(at ? { snippet, at: at.toISOString() } : { snippet });
      }
    }
    if (taHits > 0 || userHits < minUser || evidence.length < 3) continue;
    out.push({
      id: idFor(domain.id),
      pattern: copy(locale, domain.nameKey),
      kind: "knowledge_boundary",
      confidence: 0.7,
      source: "auto",
      verified: false,
      evidence,
    });
  }
  return normalizeSuppressions(out);
}
