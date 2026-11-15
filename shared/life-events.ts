/**
 * What is going on in their life, and what was left unfinished.
 *
 * These are written by the user, in the persona's own jsonb, until the
 * foreign-key debt of a real table is paid. An automatic candidate from
 * the records is stored here too, unverified, and it does not reach a
 * proactive prompt until it is confirmed.
 */
export type LifeEventKind = "life" | "open_loop";

export interface LifeEventEvidence {
  at?: string;
  snippet: string;
}

export interface LifeEvent {
  id: string;
  kind: LifeEventKind;
  title: string;
  detail: string;
  /** Who said it — the user, them, or both. */
  whoSaid: string;
  /** When it ends, if it has an end. */
  endsAt?: string;
  closed: boolean;
  source: "auto" | "manual";
  verified: boolean;
  evidence: LifeEventEvidence[];
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function toEvidence(value: unknown): LifeEventEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: LifeEventEvidence[] = [];
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

export function normalizeLifeEvents(value: unknown): LifeEvent[] {
  if (!Array.isArray(value)) return [];
  const out: LifeEvent[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const title = toText(record.title);
    if (!title) return;
    const kind: LifeEventKind = record.kind === "open_loop" ? "open_loop" : "life";
    const source = record.source === "auto" ? "auto" : "manual";
    out.push({
      id: toText(record.id) || `${kind}-${index + 1}`,
      kind,
      title,
      detail: toText(record.detail),
      whoSaid: toText(record.whoSaid),
      ...(toText(record.endsAt) ? { endsAt: toText(record.endsAt) } : {}),
      closed: record.closed === true,
      source,
      verified: source === "manual" ? record.verified !== false : record.verified === true,
      evidence: toEvidence(record.evidence),
    });
  });
  return out;
}

export function activeLifeEvents(events: LifeEvent[]): LifeEvent[] {
  return events.filter((event) => event.verified && !event.closed);
}

export function openLoops(events: LifeEvent[]): LifeEvent[] {
  return activeLifeEvents(events).filter((event) => event.kind === "open_loop");
}

export function inProgressLife(events: LifeEvent[]): LifeEvent[] {
  return activeLifeEvents(events).filter((event) => event.kind === "life");
}
