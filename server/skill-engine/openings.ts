/**
 * How they start a conversation of their own, counted from the records.
 *
 * Fewer than fifteen of their own first words is not a distribution.
 * A missing profile is "not counted"; a profile with samples and a
 * rate of 0 is "counted, and they never did".
 */
import {
  OPENING_MIN_SAMPLES,
  type OpeningCounts,
  type OpeningProfile,
} from "@shared/opening-profile";
import {
  PROACTIVE_OPENINGS,
  isProactiveOpening,
  type ProactiveOpening,
} from "@shared/speech-acts";

const GAP_MS = 6 * 60 * 60 * 1000;

const RULES: Array<{ opening: ProactiveOpening; pattern: RegExp }> = [
  { opening: "logistics", pattern: /(明天|后天|几点|见面|地点|tomorrow|tonight|meet)/i },
  { opening: "affection", pattern: /(想你|爱你|抱抱|miss you|love you)/i },
  { opening: "checkin", pattern: /(吃了吗|you there|what's up|how are you)/i },
  { opening: "tease", pattern: /(哈哈|笑死|你这|lol|haha)/i },
  { opening: "callback", pattern: /(上次|那天|说好|about (that|earlier))/i },
  { opening: "share", pattern: /(我刚|我在|今天我|i just|i'm at)/i },
];

export function labelOpening(text: string): ProactiveOpening {
  const trimmed = text.trim();
  if (trimmed.length <= 6) return "fragment";
  for (const rule of RULES) {
    if (rule.pattern.test(trimmed)) return rule.opening;
  }
  return "fragment";
}

/**
 * Their own first-word lines: the start of the record, or a reply
 * after a long enough silence that it is a new conversation.
 */
export function firstWordLines(
  messages: Array<{ role: string; content: string; timestamp?: Date | string | null }>,
): string[] {
  const out: string[] = [];
  let lastUserAt: number | null = null;
  for (const row of messages) {
    const content = String(row.content ?? "").trim();
    if (!content) continue;
    const at = row.timestamp ? new Date(row.timestamp).getTime() : null;
    const when = at != null && !Number.isNaN(at) ? at : null;
    if (row.role === "user") {
      lastUserAt = when ?? lastUserAt;
      continue;
    }
    if (row.role !== "assistant") continue;
    const gap = lastUserAt != null && when != null ? when - lastUserAt : null;
    if (lastUserAt == null || (gap != null && gap >= GAP_MS)) {
      out.push(content);
    }
  }
  return out;
}

export function buildOpeningProfile(params: {
  messages: Array<{ role: string; content: string; timestamp?: Date | string | null }>;
  exchangesCounted?: number;
  spokeFirstCount?: number;
  now?: Date;
}): OpeningProfile | null {
  const lines = firstWordLines(params.messages);
  const counts: OpeningCounts = {};
  for (const line of lines) {
    const opening = labelOpening(line);
    if (!isProactiveOpening(opening)) continue;
    counts[opening] = (counts[opening] ?? 0) + 1;
  }
  const firstWordSamples = lines.length;
  const counted = params.exchangesCounted != null && params.exchangesCounted > 0;
  const rate = counted
    ? Math.max(0, Math.min(1, (params.spokeFirstCount ?? firstWordSamples) / Math.max(1, params.exchangesCounted ?? 1)))
    : firstWordSamples > 0
      ? null
      : null;
  const measuredAt = (params.now ?? new Date()).toISOString();
  if (!counted && firstWordSamples === 0) return null;
  return {
    samples: firstWordSamples,
    counts: firstWordSamples >= OPENING_MIN_SAMPLES ? counts : {},
    rate: counted ? rate : null,
    measuredAt,
  };
}

export { PROACTIVE_OPENINGS };
