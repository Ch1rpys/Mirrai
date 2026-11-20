/**
 * The rehearsal room's two guards (C3.2).
 *
 * The room shows a few ways a sentence might land. It must not answer
 * the question only the real person can answer ("do you still love me"),
 * and it must not put a promise in their mouth ("I forgive you"). Both
 * are checked here, on words, so the guard is testable and the same in
 * every path.
 */
import { SPEECH_ACTS, type SpeechAct } from "./speech-acts";

/**
 * A question whose answer belongs to the person, not the replica.
 *
 * It is deliberately narrower than "any question": "你今天忙吗" is a
 * question about a day, and a rehearsal of it is harmless. These are the
 * ones that ask for a verdict on the relationship.
 */
// i18n:allow-input — matched against what the user typed
const COMMITMENT_QUESTION_PATTERNS: RegExp[] = [
  /还爱(不爱|我吗|我吗？|我吗。)/,
  /爱不爱我/,
  /还喜欢我吗/,
  /原不原谅/,
  /能原谅我/,
  /会原谅我/,
  /要不要复合/,
  /还能复合/,
  /想不想复合/,
  /愿不愿意(回来|复合|原谅|再试)/,
  /会不会回来/,
  /还会回来/,
  /是不是不要我了/,
  /是不是不爱我了/,
  /还想要我吗/,
  /do you still love me/i,
  /do you love me/i,
  /will you forgive me/i,
  /can you forgive me/i,
  /will you come back/i,
  /do you still want me/i,
  /will you take me back/i,
];

export function isCommitmentQuestion(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return COMMITMENT_QUESTION_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * A reply that decides something on the person's behalf.
 *
 * "I miss you too" is not one of these: it is a feeling the record may
 * support. "I forgive you", "we are back together", "I don't love you
 * any more" are decisions, and the replica is not the person who gets to
 * make them.
 */
// i18n:allow-input — matched against what the model wrote
const COMMITMENT_REPLY_PATTERNS: RegExp[] = [
  /我原谅你/,
  /原谅你了/,
  /我们复合/,
  /复合吧/,
  /我们和好吧/,
  /我答应你/,
  /我同意/,
  /我还爱你/,
  /我不爱你了/,
  /我们分手/,
  /我永远(会|都)在/,
  /我保证/,
  /我发誓/,
  /i forgive you/i,
  /let'?s get back together/i,
  /i still love you/i,
  /i don'?t love you/i,
  /i promise/i,
  /i swear/i,
  /we are back together/i,
];

export function containsCommitment(reply: string): boolean {
  const value = String(reply ?? "").trim();
  if (!value) return false;
  return COMMITMENT_REPLY_PATTERNS.some((pattern) => pattern.test(value));
}

export interface ActShare {
  act: SpeechAct;
  /** Rounded to one decimal place, as the page shows it. */
  share: number;
}

/**
 * The three most likely acts, as the rehearsal cards show them.
 *
 * Acts under the floor are not worth showing: "about one time in twenty"
 * is not a way the sentence lands, it is noise. The shares are of the
 * whole distribution, so the three cards never add up to more than one.
 */
export function topRehearsalActs(
  counts: Record<string, number> | null | undefined,
  options: { minShare?: number; max?: number } = {},
): ActShare[] {
  if (!counts) return [];
  const minShare = options.minShare ?? 0.08;
  const max = options.max ?? 3;
  const entries = (Object.entries(counts) as Array<[string, number]>)
    .filter(([act, n]) => (SPEECH_ACTS as readonly string[]).includes(act) && Number(n) > 0)
    .map(([act, n]) => ({ act: act as SpeechAct, n: Number(n) }));
  const total = entries.reduce((sum, entry) => sum + entry.n, 0);
  if (total <= 0) return [];
  const chosen = entries
    .map((entry) => ({ act: entry.act, exact: entry.n / total }))
    .filter((entry) => entry.exact >= minShare)
    .sort((a, b) => b.exact - a.exact || a.act.localeCompare(b.act))
    .slice(0, max);

  let spent = 0;
  return chosen.map((entry) => {
    const rounded = Math.min(
      1 - spent,
      Math.round(entry.exact * 10) / 10,
    );
    spent += rounded;
    return { act: entry.act, share: Math.max(0, Math.round(rounded * 10) / 10) };
  });
}
