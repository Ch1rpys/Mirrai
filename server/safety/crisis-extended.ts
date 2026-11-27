/**
 * The three-layer crisis check.
 *
 * `crisis.ts` matches a keyword list. `crisis-indirect.ts` matches the
 * ways of saying it that have a shape. `crisis-semantic.ts` compares the
 * message with two hand-written groups of sentences on the user's own
 * local model.
 *
 * This module is the one place that combines them, so the chat path
 * cannot pick up one layer and miss another.
 *
 * The direction is fixed: **the new layers only ever make the answer
 * more careful.** A keyword crisis stays a crisis whatever the other two
 * say. The other two can raise:
 *
 *   - one indirect family, or the semantic layer → a weak signal
 *   - two different indirect families → a crisis
 *   - one indirect family plus planning language → a crisis
 *
 * Everything here is local. The semantic layer talks to the user's own
 * Ollama and nothing else; when that daemon is not there, the layer is
 * absent and this function is exactly the keyword + pattern check.
 */
import { detectCrisis, type CrisisDetection } from "./crisis";
import {
  detectIndirectCrisis,
  hasMultipleReasons,
  hasPlanWithReason,
  type IndirectFamily,
} from "./crisis-indirect";
import {
  detectCrisisSemantic,
  type DetectCrisisSemanticOptions,
  type SemanticCrisisResult,
} from "./crisis-semantic";
import { toSimplified } from "@shared/han-normalize";

export interface ExtendedCrisisDetection extends CrisisDetection {
  /** The indirect families the message belongs to. */
  indirectFamilies: IndirectFamily[];
  /** Whether the local semantic layer raised a weak signal. Only for the log. */
  semanticMatched: boolean;
  /** Why a crisis was decided, when the keyword list did not decide it. */
  raisedBy: "keyword" | "families" | "plan" | null;
}

export interface DetectCrisisExtendedOptions {
  /** The local semantic layer. `false` turns it off (tests, and callers that must not wait). */
  semantic?: DetectCrisisSemanticOptions | false;
}

/**
 * Inspects a user message for crisis language, with every local layer.
 *
 * Async because one of the layers embeds the message on the local model.
 * The budget is 300 ms; past that the layer is not there and the answer
 * is the same as the keyword + pattern check.
 */
export async function detectCrisisExtended(
  text: string,
  options: DetectCrisisExtendedOptions = {},
): Promise<ExtendedCrisisDetection> {
  const base = detectCrisis(text);

  /**
   * A keyword crisis is final.
   *
   * Running the other layers first and then OR-ing would be the same
   * answer, and this way a sentence the list already caught never waits
   * for an embedding.
   */
  if (base.crisis) {
    return {
      ...base,
      indirectFamilies: [],
      semanticMatched: false,
      raisedBy: "keyword",
    };
  }

  /**
   * The other two layers read the same characters as the word list.
   *
   * The patterns and the exemplars are written in simplified Chinese;
   * a traditional sentence is the same sentence.
   */
  const simplified = toSimplified(text);
  const indirect = detectIndirectCrisis(simplified);
  const semantic: SemanticCrisisResult = options.semantic === false
    ? { matched: false, crisisSimilarity: null, safeSimilarity: null, reason: "unavailable" }
    : await detectCrisisSemantic(simplified, options.semantic);

  const reasons = indirect.families.filter((family) => family !== "plan");
  const raisedByPlan = hasPlanWithReason(indirect);
  const raisedByFamilies = hasMultipleReasons(indirect);
  const crisis = raisedByFamilies || raisedByPlan;
  const weakSignal = !crisis
    && (base.weakSignal || indirect.families.length > 0 || semantic.matched);

  return {
    crisis,
    weakSignal,
    matched: [
      ...base.matched,
      ...indirect.families.map((family) => `indirect:${family}`),
      ...(semantic.matched ? ["semantic"] : []),
    ],
    indirectFamilies: indirect.families,
    semanticMatched: semantic.matched,
    raisedBy: crisis ? (raisedByFamilies ? "families" : "plan") : null,
  };
}

/**
 * Whether the indirect layer found more than one kind of statement.
 *
 * Exported for the test that re-checks the original keyword positives:
 * every one of them must still come out as a crisis when the two new
 * layers are added on top.
 */
export { hasMultipleReasons, hasPlanWithReason };
