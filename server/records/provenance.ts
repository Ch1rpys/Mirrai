/**
 * Which parts of a reply were said before (C10.7).
 *
 * The check is C2.3's `verbatim` verdict, but it never leaves the
 * record: no model call, no embedding request. A sentence is theirs if
 * the record holds exactly it, or holds it from four characters up —
 * the same rule the "did they ever say this?" page uses, so the two
 * cannot disagree about a line.
 *
 * Everything here is best effort after the fact: the message is already
 * stored when this runs, and a failure means "no underline", never a
 * failed reply.
 */
import { candidateRecordsByOverlap, updateMessageMetadata } from "../db";
import {
  normalizeForNearest,
  splitSentences,
} from "../records/nearest";
import type { ProvenanceSpan } from "@shared/provenance";

/** Shorter quotes do not count by inclusion, exactly as in C2.3. */
const MIN_CONTAINED_CHARS = 4;

/** A candidate row, as the literal search returns it. */
interface Candidate {
  id: number;
  content: string;
  timestamp?: Date | null;
}

/**
 * Finds the newest record that says this exactly — or, from four
 * characters up, contains it.
 *
 * The newest is chosen because a later line is the one the person would
 * have said most recently; the date shown under the underline is then
 * the date of the line the app is pointing at.
 */
async function newestVerbatim(
  personaId: number,
  userId: number,
  text: string,
): Promise<Candidate | null> {
  const normalized = normalizeForNearest(text);
  if (!normalized) return null;
  const rows = (await candidateRecordsByOverlap(personaId, userId, {
    text,
    role: "assistant",
    limit: 200,
  })) as Candidate[];
  const exact = rows.filter((row) => normalizeForNearest(row.content) === normalized);
  const contained = exact.length > 0 || [...normalized].length < MIN_CONTAINED_CHARS
    ? exact
    : rows.filter((row) => normalizeForNearest(row.content).includes(normalized));
  const matches = exact.length > 0 ? exact : contained;
  if (matches.length === 0) return null;
  return [...matches].sort(
    (a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0),
  )[0]!;
}

function spanOf(match: Candidate, start: number, end: number): ProvenanceSpan {
  return {
    start,
    end,
    recordId: match.id,
    at: match.timestamp ? match.timestamp.toISOString() : null,
  };
}

/**
 * The provenance of one message.
 *
 * `forcedRecordId` is for the replies that are known to be the record's
 * own words before the search runs (a fixed reply, a follow-up line, a
 * typo fix): the whole message is marked. When that record was deleted
 * between the reply and this check, the sentence search still finds
 * nothing and nothing is marked.
 */
export async function computeProvenance(params: {
  personaId: number;
  userId: number;
  text: string;
  /** The record a forced (verbatim) reply came from. */
  forcedRecordId?: number | null;
  /** The whole message is known to be the record's words. */
  wholeTextIsVerbatim?: boolean;
  /** Test seam: the record lookup. */
  findVerbatim?: (text: string) => Promise<Candidate | null>;
}): Promise<ProvenanceSpan[]> {
  const text = params.text ?? "";
  if (!text.trim()) return [];
  const find = params.findVerbatim
    ?? ((value: string) => newestVerbatim(params.personaId, params.userId, value));

  if (params.forcedRecordId || params.wholeTextIsVerbatim) {
    const match = await find(text);
    if (match) {
      const span = spanOf(match, 0, text.length);
      if (!params.forcedRecordId || match.id === params.forcedRecordId) return [span];
      // A different record says the same thing; the words are still the
      // record's, so the underline stands, pointing at the line found.
      return [span];
    }
    if (params.forcedRecordId) {
      // The reply carries the id it was taken from even when the search
      // no longer returns it (an encrypted account, or a row that was
      // removed). The id and the whole message are enough.
      return [{ start: 0, end: text.length, recordId: params.forcedRecordId, at: null }];
    }
    return [];
  }

  const spans: ProvenanceSpan[] = [];
  let cursor = 0;
  for (const sentence of splitSentences(text)) {
    if (!sentence.trim()) continue;
    const at = text.indexOf(sentence, cursor);
    const start = at === -1 ? cursor : at;
    cursor = start + sentence.length;
    const match = await find(sentence);
    if (!match) continue;
    spans.push(spanOf(match, start, start + sentence.length));
  }
  return spans;
}

/**
 * Computes the provenance of a stored message and writes it down.
 *
 * Never throws: the message is already on screen and in the transcript,
 * and a failure here costs an underline, not the reply.
 */
export async function attachMessageProvenance(params: {
  messageId: number;
  personaId: number;
  userId: number;
  text: string;
  forcedRecordId?: number | null;
  wholeTextIsVerbatim?: boolean;
}): Promise<ProvenanceSpan[] | null> {
  try {
    const spans = await computeProvenance(params);
    if (spans.length === 0) return [];
    await updateMessageMetadata(params.messageId, params.userId, params.personaId, {
      provenance: spans,
    });
    return spans;
  } catch (error) {
    console.warn("[Provenance] Could not mark the reply's own words:", error);
    return null;
  }
}
