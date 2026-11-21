/**
 * Splits the record where it went quiet for two weeks.
 *
 * The persona stays one document. Only the deltas — action counts and
 * subtractions — are stored per stretch. A record that cannot be cut
 * stays one stretch, and the selector is not shown.
 */
import {
  findPeriodSplits,
  periodsFromSplits,
  type PersonaPeriod,
} from "@shared/periods";
import {
  emptyCounts,
  incrementCount,
  type ActProfile,
} from "@shared/act-profile";
import type { Suppression } from "@shared/suppressions";
import { labelSpeechActByRule } from "@shared/speech-acts";
import { mineForgetStyles, mineSuppressions } from "./suppressions";
import { mineMultiPoint } from "@shared/multi-point";
import type { Locale } from "@shared/copy";

export function minePeriods(params: {
  messages: Array<{ role: string; content: string; timestamp: Date | null }>;
  actProfiles?: ActProfile[];
  suppressions?: Suppression[][];
  locale?: Locale;
}): PersonaPeriod[] {
  const splits = findPeriodSplits(params.messages);
  const periods = periodsFromSplits(params.messages, splits);
  return periods.map((period, index) => {
    const slice = messagesInPeriod(params.messages, period, index === periods.length - 1);
    return {
      ...period,
      actProfileDelta: params.actProfiles?.[index] ?? actDeltaFromMessages(slice),
      suppressionsDelta: params.suppressions?.[index] ?? [
        ...mineSuppressions({ messages: slice, locale: params.locale }),
        ...mineForgetStyles({ messages: slice, locale: params.locale }),
        ...mineMultiPoint({ messages: slice, locale: params.locale }),
      ],
    };
  });
}

function messagesInPeriod(
  messages: Array<{ role: string; content: string; timestamp: Date | null }>,
  period: PersonaPeriod,
  last: boolean,
) {
  const start = new Date(period.from).getTime();
  const end = new Date(period.to).getTime();
  return messages.filter((row) => {
    if (!row.timestamp) return false;
    const at = row.timestamp.getTime();
    if (Number.isNaN(at)) return false;
    return last ? at >= start && at <= end : at >= start && at < end;
  });
}

/**
 * How this stretch acted, counted from the words a rule can see.
 *
 * The current-period full profile still lives on the persona. This is
 * only the delta the selector switches in — so two stretches can
 * disagree even when neither side is thick enough for a distilled
 * distribution.
 */
function actDeltaFromMessages(
  messages: Array<{ role: string; content: string }>,
): ActProfile | null {
  const unconditional = emptyCounts();
  let samples = 0;
  let previousUser: string | null = null;
  for (const row of messages) {
    if (row.role === "user") {
      previousUser = row.content;
      continue;
    }
    if (row.role !== "assistant") continue;
    const act = labelSpeechActByRule(row.content, previousUser);
    if (!act) continue;
    Object.assign(unconditional, incrementCount(unconditional, act));
    samples += 1;
  }
  if (!samples) return null;
  return {
    samples,
    unconditional,
    buckets: [],
    measuredAt: new Date().toISOString(),
  };
}
