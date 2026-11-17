/**
 * The closed set of things a turn can be doing.
 *
 * A persona that is asked to "sound like them" will invent an action
 * the person would never have taken — answering a question they would
 * have ignored, offering advice they would never have given. The action
 * has to be chosen *before* the words, from this person's own counts,
 * or the words will be written around the wrong verb.
 *
 * Adding a label means changing this file, the roadmap, the copy, and
 * the editors. The lists below are the contract.
 */
import { copy, type Locale } from "./copy";

/** What this turn of theirs is doing. */
export const SPEECH_ACTS = [
  "answer",
  "acknowledge",
  "comfort",
  "tease",
  "affection",
  "advise",
  "logistics",
  "deflect",
  "repair",
  "share",
  "silence",
] as const;

export type SpeechAct = (typeof SPEECH_ACTS)[number];

/**
 * What the other person is doing in their turn.
 *
 * Distillation writes this on the user's last line of a round so later
 * layers (adjacency, a tap-back, the mirror) can condition on it.
 * Adding a label means changing this list and every place that reads it.
 */
export const USER_ACTS = [
  "ask",
  "acknowledge",
  "share",
  "affection",
  "tease",
  "complain",
  "logistics",
  "repair",
  "comfort",
  "advise",
  "other",
] as const;

export type UserAct = (typeof USER_ACTS)[number];

/** Why a user said a reply did not sound like them. */
export const FEEDBACK_REASONS = [
  "act",
  "complete",
  "ask",
  "word",
  "invented",
  "mood",
  "timing",
] as const;

export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/** What they are doing when they speak first. */
export const PROACTIVE_OPENINGS = [
  "share",
  "callback",
  "checkin",
  "logistics",
  "affection",
  "tease",
  "fragment",
] as const;

export type ProactiveOpening = (typeof PROACTIVE_OPENINGS)[number];

const ACT_SET = new Set<string>(SPEECH_ACTS);
const USER_ACT_SET = new Set<string>(USER_ACTS);
const FEEDBACK_SET = new Set<string>(FEEDBACK_REASONS);
const OPENING_SET = new Set<string>(PROACTIVE_OPENINGS);

export function isSpeechAct(value: unknown): value is SpeechAct {
  return typeof value === "string" && ACT_SET.has(value);
}

export function isUserAct(value: unknown): value is UserAct {
  return typeof value === "string" && USER_ACT_SET.has(value);
}

export function isFeedbackReason(value: unknown): value is FeedbackReason {
  return typeof value === "string" && FEEDBACK_SET.has(value);
}

export function isProactiveOpening(value: unknown): value is ProactiveOpening {
  return typeof value === "string" && OPENING_SET.has(value);
}

const ACKNOWLEDGE =
  /^(嗯+|哦+|噢+|啊+|好+|在+|行+|收到|好的|好吧|ok+|okay|got it|yes|yeah|yep|mm+|mhm)[。.!！?？…~～]*$/i;

const LOGISTICS =
  /(明天|后天|今晚|中午|晚上|早上|周[一二三四五六日天]|星期[一二三四五六日天]|几点|\d+\s*点|见面|到了|出发|过来|过去|地址|地点|地铁|车站|tomorrow|tonight|o'?clock|meet (up|at)|on the way)/i;

const REPAIR = /(对不起|抱歉|我错了|是我不好|sorry|i was wrong|forgive me)/i;
const AFFECTION = /(爱你|想你|抱抱|亲亲|想死你了|love you|miss you|hug)/i;
const COMFORT = /(没事的|别难过|别怕|辛苦了|会好的|我在|there there|it'?s okay|i'?m here)/i;
const ADVISE = /(你可以|你应该|建议你|不如|最好|you should|you could|maybe you|why don'?t you)/i;
const TEASE = /(哈哈+|开玩笑|损你|傻|笨|lol+|haha+|lmao)/i;
const SHARE_SELF = /^(我|俺|咱).{2,}/;

/**
 * Labels a line from the words alone, when the words are enough.
 *
 * A one-word "嗯" is an acknowledgement. A line that names a time and a
 * place is logistics. The rest is left unlabelled: guessing "answer"
 * because the previous line had a question mark is still a guess, and
 * a wrong label in the prompt is worse than no label.
 *
 * Returns null when a rule cannot decide. Distillation caches a model
 * label for those; evaluation never re-asks the model.
 */
export function labelSpeechActByRule(
  text: string,
  previousUser?: string | null,
  options?: { precisionOnly?: boolean },
): SpeechAct | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "silence";

  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length <= 8 && ACKNOWLEDGE.test(compact)) return "acknowledge";
  if (REPAIR.test(trimmed)) return "repair";
  if (options?.precisionOnly) return null;

  if (LOGISTICS.test(trimmed) && (/\d|点|见|到|来|meet|at /i.test(trimmed))) {
    return "logistics";
  }
  if (COMFORT.test(trimmed)) return "comfort";
  if (ADVISE.test(trimmed)) return "advise";
  if (AFFECTION.test(trimmed) && trimmed.length < 40) return "affection";
  if (TEASE.test(trimmed) && !REPAIR.test(trimmed)) return "tease";
  if (SHARE_SELF.test(trimmed) && !/[?？]$/.test(trimmed) && previousUser && !/[?？]$/.test(previousUser.trim())) {
    return "share";
  }
  if (previousUser && /[?？]$/.test(previousUser.trim()) && !/[?？]$/.test(trimmed)) {
    return "answer";
  }
  return null;
}

/**
 * Labels the other person's line from the words alone, when the words
 * are enough.
 *
 * A question is an ask. A one-word "嗯" is an acknowledgement. The rest
 * is left unlabelled so distillation can ask a model rather than guess.
 */
export function labelUserActByRule(text: string): UserAct | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  if (isUserAsking(trimmed) || endsWithMa(trimmed)) return "ask";
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length <= 8 && ACKNOWLEDGE.test(compact)) return "acknowledge";
  if (REPAIR.test(trimmed)) return "repair";
  if (AFFECTION.test(trimmed) && trimmed.length < 40) return "affection";
  return null;
}

function endsWithMa(text: string): boolean {
  return /[吗]$/.test(text.replace(/[。.!！?？…~～]+$/g, ""));
}

/** True when the other person asked a question this turn. */
export function isUserAsking(text: string | null | undefined): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  if (/[?？]/.test(trimmed)) return true;
  return /^(怎么|为什么|哪|谁|几|吗|么|what|why|where|when|who|how|is |are |do |did |can )/i.test(
    trimmed,
  );
}

const ACT_COPY_KEYS: Record<SpeechAct, `prompt.act.${SpeechAct}`> = {
  answer: "prompt.act.answer",
  acknowledge: "prompt.act.acknowledge",
  comfort: "prompt.act.comfort",
  tease: "prompt.act.tease",
  affection: "prompt.act.affection",
  advise: "prompt.act.advise",
  logistics: "prompt.act.logistics",
  deflect: "prompt.act.deflect",
  repair: "prompt.act.repair",
  share: "prompt.act.share",
  silence: "prompt.act.silence",
};

const USER_ACT_COPY_KEYS: Record<UserAct, `prompt.act.${SpeechAct}` | `prompt.userAct.${"ask" | "complain" | "other"}`> = {
  ask: "prompt.userAct.ask",
  acknowledge: "prompt.act.acknowledge",
  share: "prompt.act.share",
  affection: "prompt.act.affection",
  tease: "prompt.act.tease",
  complain: "prompt.userAct.complain",
  logistics: "prompt.act.logistics",
  repair: "prompt.act.repair",
  comfort: "prompt.act.comfort",
  advise: "prompt.act.advise",
  other: "prompt.userAct.other",
};

const OPENING_COPY_KEYS: Record<ProactiveOpening, `prompt.opening.${ProactiveOpening}`> = {
  share: "prompt.opening.share",
  callback: "prompt.opening.callback",
  checkin: "prompt.opening.checkin",
  logistics: "prompt.opening.logistics",
  affection: "prompt.opening.affection",
  tease: "prompt.opening.tease",
  fragment: "prompt.opening.fragment",
};

/** The instruction that says this turn does one thing. */
export function renderActInstruction(act: SpeechAct, locale: Locale = "zh"): string {
  return [
    copy(locale, "prompt.actHeading"),
    copy(locale, "prompt.actOnly", { act: copy(locale, ACT_COPY_KEYS[act]) }),
    copy(locale, "prompt.actKeepVoice"),
  ].join("\n");
}

export function renderOpeningInstruction(
  opening: ProactiveOpening,
  locale: Locale = "zh",
): string {
  return copy(locale, "prompt.openingOnly", {
    opening: copy(locale, OPENING_COPY_KEYS[opening]),
  });
}

export { ACT_COPY_KEYS, OPENING_COPY_KEYS, USER_ACT_COPY_KEYS };
