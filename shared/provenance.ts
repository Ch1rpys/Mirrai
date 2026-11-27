/**
 * The parts of a reply that were said before (C10.7).
 *
 * A persona's reply is rebuilt, so it is mostly invention — but some
 * lines are the person's own words: a fixed reply, a follow-up line, a
 * corrected typo, or a model sentence that happens to match the record
 * verbatim. The app knows which, and this is the shape it stores and
 * shows.
 *
 * Offsets are into the message text as stored, in JavaScript string
 * indices.
 */
export interface ProvenanceSpan {
  /** First character of the quoted stretch. */
  start: number;
  /** One past the last character. */
  end: number;
  /** The record the words came from. */
  recordId: number;
  /** When it was said, ISO, when known. */
  at?: string | null;
}

function isSpan(value: unknown): value is ProvenanceSpan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.start === "number"
    && typeof row.end === "number"
    && typeof row.recordId === "number"
    && row.start >= 0
    && row.end > row.start;
}

/** Reads the spans out of a message's metadata. Bad entries are dropped. */
export function provenanceFromMetadata(metadata: unknown): ProvenanceSpan[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const raw = (metadata as { provenance?: unknown }).provenance;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSpan).map((span) => ({
    start: span.start,
    end: span.end,
    recordId: span.recordId,
    at: typeof span.at === "string" ? span.at : null,
  }));
}

export interface ProvenanceSegment {
  text: string;
  span?: ProvenanceSpan;
}

/**
 * Cuts the message text at its spans.
 *
 * Spans that overlap or sit outside the text are ignored — a stored
 * message can be edited after it was written, and the offsets are then
 * stale. The text is always returned whole: a span that no longer fits
 * loses its underline, not its words.
 */
export function provenanceSegments(
  text: string,
  spans: ProvenanceSpan[],
): ProvenanceSegment[] {
  const valid = spans
    .filter((span) => span.start >= 0 && span.end <= text.length && span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const segments: ProvenanceSegment[] = [];
  let cursor = 0;
  for (const span of valid) {
    if (span.start < cursor) continue; // overlapping or inside the previous span
    if (span.start > cursor) segments.push({ text: text.slice(cursor, span.start) });
    segments.push({ text: text.slice(span.start, span.end), span });
    cursor = span.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
