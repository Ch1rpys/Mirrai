/**
 * Caches a speech-act label on each held-out case.
 *
 * A rule that can decide does. The rest is asked of the model once, then
 * stored on the case. Evaluation reads the stored label and does not
 * ask again.
 */
import { labelSpeechActByRule, type SpeechAct } from "@shared/speech-acts";
import { labelMissingActs } from "../skill-engine/acts";
import type { EvalCaseData } from "./dataset";
import type { Locale } from "@shared/copy";

export async function labelEvalCases(
  cases: EvalCaseData[],
  options: { userId: number; locale?: Locale },
): Promise<EvalCaseData[]> {
  if (!cases.length) return cases;
  const unlabeled = cases.flatMap((item, index) => {
    if (item.expectedAct) return [];
    const previousUser = [...item.context].reverse().find((row) => row.role === "user")?.content ?? null;
    return [{
      key: String(index),
      content: item.expected.content,
      previousUser,
    }];
  });
  const labelled = unlabeled.length
    ? await labelMissingActs({
        items: unlabeled,
        userId: options.userId,
        locale: options.locale ?? "zh",
      }).catch(() => new Map<string, { act: SpeechAct; source: "rule" | "model" }>())
    : new Map<string, { act: SpeechAct; source: "rule" | "model" }>();

  return cases.map((item, index) => {
    if (item.expectedAct) return item;
    const found = labelled.get(String(index));
    if (found) {
      return { ...item, expectedAct: found.act, expectedActSource: found.source };
    }
    const previousUser = [...item.context].reverse().find((row) => row.role === "user")?.content ?? null;
    const byRule = labelSpeechActByRule(item.expected.content, previousUser);
    if (!byRule) return item;
    return { ...item, expectedAct: byRule, expectedActSource: "rule" };
  });
}
