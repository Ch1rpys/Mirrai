/**
 * Which portrait fields can point back at observation cards.
 *
 * Some layers are a model's summary with no quoted line behind them.
 * Those are always marked as inferred.
 */
export const EVIDENCE_DIMENSIONS = [
  "expression",
  "trigger",
  "conflict",
  "care",
  "memory",
  "habit",
] as const;

export type EvidenceDimension = (typeof EVIDENCE_DIMENSIONS)[number];

export const EVIDENCE_FIELDS = [
  "speakingStyle",
  "catchphrases",
  "personality",
  "conflictStyle",
  "touchingMoments",
  "memories",
  "attachmentStyle",
  "loveLanguage",
] as const;

export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

export const EVIDENCE_FIELD_DIMENSIONS: Record<EvidenceField, readonly EvidenceDimension[]> = {
  speakingStyle: ["expression", "habit"],
  catchphrases: ["expression", "habit"],
  personality: ["trigger", "care", "habit"],
  conflictStyle: ["conflict"],
  touchingMoments: ["memory"],
  memories: ["memory"],
  attachmentStyle: [],
  loveLanguage: [],
};

export const EVIDENCE_ALWAYS_INFERRED: readonly EvidenceField[] = [
  "attachmentStyle",
  "loveLanguage",
];

export const EVIDENCE_CARD_LIMIT = 30;

export interface EvidenceQuote {
  recordId: number;
  at: string | null;
  speaker: string;
  text: string;
}

export interface EvidenceCard {
  claim: string;
  periodId: string | null;
  quotes: EvidenceQuote[];
}

export type EvidenceByDimension = Record<EvidenceDimension, EvidenceCard[]>;

export function isEvidenceDimension(value: unknown): value is EvidenceDimension {
  return typeof value === "string" && (EVIDENCE_DIMENSIONS as readonly string[]).includes(value);
}

export function isAlwaysInferred(field: EvidenceField): boolean {
  return EVIDENCE_ALWAYS_INFERRED.includes(field);
}

export function emptyEvidenceByDimension(): EvidenceByDimension {
  return {
    expression: [],
    trigger: [],
    conflict: [],
    care: [],
    memory: [],
    habit: [],
  };
}

export function cardsForField(
  field: EvidenceField,
  byDimension: EvidenceByDimension | null | undefined,
): EvidenceCard[] {
  const source = byDimension ?? emptyEvidenceByDimension();
  return EVIDENCE_FIELD_DIMENSIONS[field].flatMap((dimension) => source[dimension] ?? []);
}

export function fieldIsInferred(
  field: EvidenceField,
  byDimension: EvidenceByDimension | null | undefined,
): boolean {
  if (isAlwaysInferred(field)) return true;
  return cardsForField(field, byDimension).length === 0;
}

function quoteIds(payload: unknown): number[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const quotes = (payload as { quotes?: unknown }).quotes;
  if (!Array.isArray(quotes)) return [];
  const ids: number[] = [];
  for (const item of quotes) {
    const id = typeof item === "number" ? item : Number(item);
    if (Number.isInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

export interface StoredObservationCard {
  dimension?: string | null;
  claim?: string | null;
  periodId?: string | null;
  payload?: unknown;
  createdAt?: Date | string | null;
}

export interface EvidenceRecord {
  id: number;
  content?: string | null;
  timestamp?: Date | string | null;
  speaker?: string | null;
  role?: string | null;
}

function createdAtMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function atIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Turns stored observation cards into quotes the profile can show.
 *
 * A quote that is not in the record table is dropped, so the page never
 * points at a line that is not there.
 */
export function collectEvidence(
  cards: StoredObservationCard[],
  records: EvidenceRecord[],
): EvidenceByDimension {
  const byId = new Map(records.map((row) => [row.id, row]));
  const grouped: Record<EvidenceDimension, StoredObservationCard[]> = {
    expression: [],
    trigger: [],
    conflict: [],
    care: [],
    memory: [],
    habit: [],
  };
  for (const card of cards) {
    if (!isEvidenceDimension(card.dimension)) continue;
    grouped[card.dimension].push(card);
  }
  const out = emptyEvidenceByDimension();
  for (const dimension of EVIDENCE_DIMENSIONS) {
    const sorted = [...grouped[dimension]].sort(
      (a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt),
    );
    out[dimension] = sorted.slice(0, EVIDENCE_CARD_LIMIT).map((card) => ({
      claim: String(card.claim ?? "").trim(),
      periodId: card.periodId ?? null,
      quotes: quoteIds(card.payload).flatMap((recordId) => {
        const row = byId.get(recordId);
        if (!row) return [];
        return [{
          recordId,
          at: atIso(row.timestamp),
          speaker: String(row.speaker || row.role || ""),
          text: String(row.content ?? ""),
        }];
      }),
    }));
  }
  return out;
}
