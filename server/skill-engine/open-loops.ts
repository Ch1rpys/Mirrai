/**
 * Unfinished business, read off the records.
 *
 * A candidate must quote the line it was read from. "We'll do it later"
 * with no original sentence is dropped. Confirmed rows survive a
 * re-distillation through mergeUserDecisions.
 */
import { normalizeLifeEvents, type LifeEvent } from "@shared/life-events";

const MARKERS = /(说好|改天|下次|等你|later|next time|we should|remind me)/i;

export function mineOpenLoops(params: {
  messages: Array<{ role: string; content: string; timestamp?: Date | string | null }>;
}): LifeEvent[] {
  const out: LifeEvent[] = [];
  params.messages.forEach((row, index) => {
    const content = String(row.content ?? "").trim();
    if (!content || !MARKERS.test(content)) return;
    const whoSaid = row.role === "assistant" ? "them" : row.role === "user" ? "me" : null;
    if (!whoSaid) return;
    const at = row.timestamp ? String(row.timestamp) : undefined;
    out.push({
      id: `open-loop-${index + 1}`,
      kind: "open_loop",
      title: content.slice(0, 80),
      detail: content.slice(0, 400),
      whoSaid,
      closed: false,
      source: "auto",
      verified: false,
      evidence: [{ snippet: content.slice(0, 400), ...(at ? { at } : {}) }],
    });
  });
  return normalizeLifeEvents(out).filter((event) => event.evidence.length > 0);
}
