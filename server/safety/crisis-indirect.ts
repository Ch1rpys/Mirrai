/**
 * Distress that does not use a crisis word.
 *
 * The keyword list in `crisis.ts` only catches the sentences that name
 * death or self-harm. People who are close to it often do not name it:
 * they say they do not want to wake up, that everyone would be better
 * off without them, that they cannot go on, that they want to
 * disappear, that they are getting their things in order. None of those
 * words are in the list, so every one of them used to get an ordinary
 * in-character reply and nothing else.
 *
 * This module groups those ways of saying it into families. A family is
 * one *kind* of statement — not one phrase — because the same thing is
 * said a hundred ways.
 *
 * The evidence is combined in `crisis-extended.ts`:
 *
 *   - one family            → a weak signal (the existing gentle check-in)
 *   - two different families → a crisis
 *   - one family plus a plan → a crisis
 *
 * A plan by itself is a weak signal: planning language turns up in
 * ordinary conversations ("I picked a date" for a trip), and treating it
 * as a crisis on its own would interrupt people who are fine. It only
 * escalates when it sits next to something that is not fine.
 *
 * The patterns are matched against simplified Chinese, so the caller
 * converts the text first (`toSimplified` in `@shared/han-normalize`).
 * That is done once in `detectCrisisExtended`, in front of both new
 * layers, the same way `detectCrisis` does it for the word lists.
 */

/** The kinds of statement this layer recognises. */
export const INDIRECT_FAMILIES = [
  "cant_wake",
  "burden",
  "cant_go_on",
  "disappear",
  "farewell",
  "plan",
] as const;

export type IndirectFamily = (typeof INDIRECT_FAMILIES)[number];

export interface IndirectDetection {
  /** The families the text belongs to, in `INDIRECT_FAMILIES` order. */
  families: IndirectFamily[];
  /** Whether anything in the text points at a time, a way or a place. */
  planned: boolean;
}

/**
 * One family's patterns.
 *
 * A list of regular expressions rather than a list of phrases, because
 * the words around the core of the sentence change: 「真的不想醒来了」
 * and 「不想再醒来」 are the same statement.
 */
interface FamilyPatterns {
  zh: RegExp[];
  en: RegExp[];
}

/**
 * The patterns themselves.
 *
 * They are deliberately narrow. A pattern that fires on ordinary
 * conversation is worse than a pattern that misses one wording: the
 * first turns a normal evening into an intervention, and the person
 * learns to distrust the app.
 *
 * i18n:allow-input — matched against what the user typed.
 */
const FAMILY_PATTERNS: Record<IndirectFamily, FamilyPatterns> = {
  cant_wake: {
    zh: [
      /不想(?:再)?醒(?:来|过)?/,
      /没(?:有)?(?:想|必要)(?:再)?(?:醒|睁开眼)/,
      /(?:一|长)睡不醒/,
      /睡(?:过去|下去)(?:就)?(?:好了|算了|别醒)/,
      /不想(?:再)?(?:睁开眼)?(?:面对|看见)(?:明早|明天|第二天|新的一天)/,
      /睡(?:下去|过去)(?:就)?(?:不用|不会)(?:再)?醒(?:来)?/,
      /**
       * The hopeful way it is written (C10.2 acceptance finding).
       *
       * "我希望明天不用醒来" and "真希望明天不用睁开眼睛" are the same
       * statement as "我不想醒来"; they were the one phrasing of this
       * family the layer did not hear, even though they are in its own
       * semantic exemplar group. The pattern stays narrow — the wish
       * has to be about waking — so "希望明天不用上班" is not a match.
       */
      /希望(?:自己|我)?(?:明天|明早|第二天|一觉醒来)?(?:再也)?(?:不用|不要|不能|无法)(?:再)?(?:醒来|醒过来|醒|睁开?眼(?:睛)?)/,
      /**
       * "我好像醒不过来了" — a first-person statement, so a story about
       * somebody else ("他喝多了醒不过来") is not a match.
       */
      /(?:我|自己)(?:好像|感觉|真的|已经)?(?:再也)?(?:要|会|快)?醒不过来/,
      /不想(?:再)?睁开(?:眼|眼睛)/,
    ],
    en: [
      /(?:don'?t|do not) want to wake up/,
      /(?:don'?t|do not) want to see (?:tomorrow|the next (?:morning|day))/,
      /(?:wish|hope) i (?:could|would|might)? ?(?:just )?(?:never )?wake up(?: again)?/,
      /(?:want|wanna) to sleep (?:forever|and never wake up)/,
      /(?:never|not) want to wake (?:up )?again/,
      /wish i (?:could|would) (?:just )?sleep forever/,
    ],
  },
  burden: {
    zh: [
      /没有我(?:,|，| )?(?:你们|大家|别人|他们|你|所有人)?(?:会|应该|肯定|也许)?更好/,
      /(?:你们|大家|别人|他们|所有人)(?:没有我)?(?:会|应该)?更好(?:吧|了)?/,
      /我(?:觉得)?(?:自己)?(?:是|就是|成了|真是个)(?:个|一个)?(?:累赘|负担|拖累|包袱)/,
      /我(?:活着)?(?:只会|就是)?(?:拖累|连累|害了?)(?:你们|大家|别人|所有人|身边|他|她)/,
      /我(?:活着)?(?:只会|就是)?(?:给|让)(?:你们|大家|别人|爸妈)(?:添|带来)?(?:麻烦|负担)/,
      /不(?:该|应该)(?:把|让)?我(?:生下来|存在|活着)/,
      /要是(?:从来)?没有我(?:就好了|该多好|多好)/,
    ],
    en: [
      /better off without me/,
      /(?:everyone|everybody|they|you|all of you)(?:\s+would|'d)? be better off(?: without me| if i (?:wasn'?t|weren'?t|was not|were not) here)?/,
      /(?:i'?m|i am)(?: just| such)?(?: a)?\s*(?:burden|dead weight)/,
      /i (?:only |just )?(?:drag|bring)(?: everyone| everybody| you| them| people| others)? down/,
      /i (?:just )?(?:cause|bring)(?: everyone| everybody| you)?(?: trouble| pain)/,
      /(?:no one|nobody) (?:would|will) (?:miss|notice)(?: me)?/,
    ],
  },
  cant_go_on: {
    zh: [
      /(?:撑|坚持|熬|扛)不下去/,
      /(?:撑|坚持|熬|扛)不住/,
      /(?:实在|真的)?(?:坚持|承受|受)不了(?:了)?/,
      /(?:真的|已经)?到(?:了)?(?:极限|尽头|临界点)/,
      /没法(?:再)?继续(?:下去|撑|活)?/,
      /(?:快|已经)到(?:了)?(?:崩溃|撑不住)的?(?:边缘|地步)/,
    ],
    en: [
      /can'?t (?:go on|keep going|hold on)(?: anymore)?/,
      /cannot (?:go on|keep going|take (?:it|this) anymore)/,
      /(?:i )?can'?t (?:take|do) (?:it|this) anymore/,
      /at the end of my rope/,
      /(?:i'?ve|i have) (?:reached|hit) my limit/,
      /(?:running|run) out of strength/,
    ],
  },
  disappear: {
    zh: [
      /(?:好|真的)?想(?:要)?(?:从(?:这个世界|世界上|这里))?消失/,
      /想(?:从(?:这个世界|世界上))消失/,
      /我?不(?:存在|在)(?:了)?(?:就|也)?(?:好了|挺好|没关系|无所谓)/,
      /当我不存在(?:就好|算了)/,
      /不想(?:再)?(?:存在|存在于|活在这个世界|活在这个世上)/,
      /(?:我)?不(?:再)?属于(?:这个|这)?(?:世界|地方|里)/,
    ],
    en: [
      /want to (?:just )?(?:disappear|vanish)/,
      /wish i (?:could|would) (?:just )?(?:disappear|vanish)/,
      /wish i (?:didn'?t|did not|wasn'?t|weren'?t) (?:exist|here)/,
      /(?:better|best) if i (?:never|didn'?t|did not) exist/,
      /wish i (?:had )?never been born/,
      /(?:want|wanna) to (?:be )?(?:gone|nowhere)/,
      /wish i (?:wasn'?t|weren'?t|was not|were not) (?:here|alive)/,
    ],
  },
  farewell: {
    zh: [
      /以后(?:要|一定)?(?:好好)?(?:照顾|保重)(?:好)?(?:自己|你们|爸妈|爸|妈|孩子)/,
      /以后(?:你们|你|大家)?要(?:好好)?(?:的|过|活)/,
      /(?:我的)?(?:东西|钱|账号|密码)(?:都|全)?(?:留给|交给|给你)/,
      /(?:大概|可能)?是(?:我)?最后一次(?:跟|和|给)你(?:说|发|写信)/,
      /(?:以后)?(?:自己|你)(?:要)?好好(?:过|活|照顾(?:好)?自己)/,
      /别(?:太|为我|替我)(?:难过|伤心)(?:太久)?/,
      /(?:替我)?(?:跟|和)(?:他们|大家|妈|爸)(?:说)(?:一声)?(?:再见|对不起)/,
      /(?:遗言|遗书|告别信)/,
    ],
    en: [
      /take care of (?:yourself|yourselves|the kids|mom|dad)(?: for me)?/,
      /(?:i'?ve|i have) (?:left|written) (?:you )?(?:a )?(?:note|letter|everything|instructions)/,
      /this is (?:my )?(?:last|final) (?:message|letter|goodbye)/,
      /this is the last time/,
      /i won'?t be (?:around|here) (?:anymore|any longer)/,
      /don'?t (?:be sad|mourn)(?: for me)?(?: too long)?/,
      /(?:\bsay|\btell) (?:them|everyone|mom|dad) (?:goodbye|i'?m sorry)/,
      /getting my (?:affairs|things) in order/,
    ],
  },
  plan: {
    zh: [
      /(?:安眠药|药片|刀片|绳子|炭)(?:已经)?(?:准备好|买好|攒够|囤好)/,
      /(?:已经)?(?:写好|写好了|留好)(?:了)?(?:遗书|遗言|告别信)/,
      /(?:选|定|挑)好(?:了)?(?:地方|地点|日子|日期|时间)/,
      /(?:地方|地点|日子|日期|时间)(?:我)?(?:已经)?(?:选|定|挑)好(?:了)?/,
      /(?:今晚|明天|凌晨|\d+点)(?:就)?(?:动手|结束|走|去了)/,
      /(?:最后|具体)(?:的)?(?:时间|日子)(?:是|定在)/,
      /(?:我)?(?:知道|想好了)(?:该)?(?:怎么|在哪|什么时候)(?:做|死|结束)/,
    ],
    en: [
      /(?:bought|got|collected|stockpiled) (?:the |some )?(?:pills|tablets|rope|knife|razor|charcoal)/,
      /(?:written|wrote) (?:a |my )?(?:suicide|goodbye|final) note/,
      /(?:picked|chose|set) (?:the |a )?(?:place|spot)/,
      /(?:picked|chose|set) (?:the )?(?:date|day)/,
      /(?:picked|chose|set) (?:the )?time (?:for|of) (?:it|this)/,
      /(?:i )?know (?:exactly )?(?:where|how) i'?(?:ll|d) (?:do it|end it)/,
      /tonight(?:'?s| is) the night/,
      /(?:i'?ve|i have) decided (?:when|how|where)/,
    ],
  },
};

/** Runs one family's patterns over the text. */
function familyMatches(patterns: FamilyPatterns, text: string, english: string): boolean {
  return patterns.zh.some((pattern) => pattern.test(text))
    || patterns.en.some((pattern) => pattern.test(english));
}

/**
 * Finds the families a message belongs to.
 *
 * The text must already be simplified Chinese and lower-cased English —
 * `detectCrisisExtended` does that once, in front of both new layers.
 * Matching here is case-insensitive anyway, so a caller that forgets the
 * normalisation still gets the English side right.
 */
export function detectIndirectCrisis(text: string): IndirectDetection {
  const haystack = text ?? "";
  if (!haystack.trim()) return { families: [], planned: false };
  /**
   * The English patterns are written in lower case; matching is
   * case-insensitive. "I Don't Want To Wake Up" is the same sentence as
   * "I don't want to wake up".
   */
  const english = haystack.toLowerCase();
  const families: IndirectFamily[] = [];
  for (const family of INDIRECT_FAMILIES) {
    if (familyMatches(FAMILY_PATTERNS[family], haystack, english)) families.push(family);
  }
  return { families, planned: families.includes("plan") };
}

/**
 * Whether the text holds a plan and at least one reason for it.
 *
 * This is the combination that escalates to a crisis. Two reasons
 * without a plan is the other one, handled in `crisis-extended.ts`.
 */
export function hasPlanWithReason(detection: IndirectDetection): boolean {
  const reasons = detection.families.filter((family) => family !== "plan");
  return detection.planned && reasons.length >= 1;
}

/**
 * Whether the text names more than one different reason.
 *
 * "I can't go on" and "everyone would be better off without me" in one
 * message is not two weak signals; it is a crisis.
 */
export function hasMultipleReasons(detection: IndirectDetection): boolean {
  const reasons = detection.families.filter((family) => family !== "plan");
  return reasons.length >= 2;
}
