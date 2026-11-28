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
 *
 * The manual lists the class by example (还爱不爱、原不原谅、要不要复合、
 * 愿不愿意、会不会回来、是不是不要我了, and their English counterparts).
 * The table below is those examples plus the same question in the words
 * people actually type — a proposal, a demand for another chance, "is it
 * over". An ordinary sentence that happens to contain one of the words
 * ("今天去参加朋友的婚礼", "I love this song") is not one.
 *
 * This is the single table. The rehearsal route used to keep a second,
 * wider copy of these patterns next to this file; the second gate
 * (`containsCommitment`) had drifted the same way, so the two paths
 * disagreed about what a promise was. Both now live here.
 */
// i18n:allow-input — matched against what the user typed
const COMMITMENT_QUESTION_PATTERNS: RegExp[] = [
  // ---- the manual's list ----
  // 还爱不爱我 / 你爱不爱我
  /爱不爱我/,
  // 你还爱我吗 / 你依然爱我吗 / 你还在乎我吗
  /(你|您)(还|依然|仍然|一直)?(爱|喜欢|在乎)(着)?我(?=[吗么呢不。！？!?\s]|$)/,
  // 还爱我吗 / 依然喜欢我吗 (the manual's class, typed without a subject)
  /(还|依然|仍然|一直)(爱|喜欢|在乎)(着)?我(?=[吗么呢不。！？!?\s]|$)/,
  // 还喜欢我吗
  /还喜欢我吗/,
  // 原不原谅我 / 能原谅我吗 / 会原谅我吗 / 你原不原谅
  /原不原谅/,
  /(你|您)?(能不能原谅|能原谅|会原谅|愿不愿意原谅|肯不肯原谅)我/,
  // 原谅我吧 / 原谅我好吗
  /原谅我(?=[吗么呢吧好。！？!?\s]|$)/,
  // 要不要复合 / 还能复合吗 / 我们和好吧
  /(要不要|想不想|愿不愿意)(复合|和好|重新开始|再试一次|重新在一起|在一起)/,
  /(我们|咱们)(还|还能|能不能|会不会|可不可以|可以|要不要|想不想)(重新开始|重新在一起|和好|复合|在一起)/,
  /(复合|和好|重新开始|重新在一起)(?=[吗么呢吧。！？!?\s]|$)/,
  // 愿不愿意再试一次 / 会不会回来 / 还会回来吗
  /愿不愿意(回来|复合|原谅|再试)/,
  /(你|您)?(还会不会|会不会|能不能|愿不愿意|肯不肯|还会|还|会|能|愿意|打算|决定)(不会|不愿意|不打算)?(回来|回到我身边)(?=[吗么呢啊呀。！？!?\s]|$)/,
  // 你会回来找我吗 ("回来陪我吃饭" is a daily request, not this family)
  /(你|您).{0,6}(回来|回到我身边)(找|要|跟|和)我/,
  // 是不是不要我了 / 是不是不爱我了
  /(?<![他她它])(是不是|是不是已经)(不要|不爱|不想要|不喜欢|不需要)我/,
  // 还想要我吗 / 你不要我了吗
  /(你|您)?(还|还想|还要|仍然想?)(要|想)我(?=[吗么呢。！？!?\s]|$)/,
  // 你会答应我吗 / 你愿意答应下来吗
  /(你|您)(会不会|愿不愿意|肯不肯|会|愿意|肯)(不会|不愿意|不肯)?(答应我|答应(下来)?|同意(和好|复合|再试|原谅|重新开始)|同意我)/,
  // 你会不会娶我 / 你愿意嫁给我吗
  /(你|您)(会不会|愿不愿意|肯不肯|想不想|要不要|会|愿意|肯|想)?(不会|不愿意|不肯)?(娶|嫁)(给我|我吧|我吗|给我吗|给我吧|我)/,
  // 嫁给我好吗 / 嫁给我吧 / 愿意嫁给我吗 / 嫁给我行吗 / 嫁给我，好吗
  // (the subject is dropped; a statement like 我想嫁给我喜欢的人 is not)
  /嫁给我(?=[\s,，、]*(?:好吗|好么|好吧|好不好|好不|行吗|行不行|可以吗|可以么|成吗|成不成|吧|吗|么|呢|嘛|$))/,
  // 我们结婚吧 / 我们结婚好吗 / 我们结婚好不好 / 我们要不要结婚
  /(我们|咱们)(要不要|该不该|是不是该)?(结婚|办婚礼|领证)(?=(?:好吗|好吧|好不好|好不|行吗|行不行|可以吗|可以么|成吗|吧|吗|么|呢|[。！？!?\s])|$)/,
  // 我想和你结婚 / 你会和我结婚吗
  /我(想|要|愿意)(和|跟|与)你(结婚|领证)/,
  /(你|您)(?:会不会|愿不愿意|想不想|要不要|打不打算)(?:和|跟|与)我(?:结婚|领证|办婚礼)/,
  /(你|您)(?:会|愿意|想|要|打算|决定)(?:和|跟|与)我(?:结婚|领证|办婚礼)(?=[吗么呢？?])/,
  // 能不能给我一次机会 / 再给我一次机会好吗
  /(能不能|可不可以|能否|能|可以|会|愿意|肯)(再)?给(我|我们)(一|另)?次机会/,
  /(再)?给(我|我们)(一|另)?次机会(?=[吗么呢吧好。！？!?\s]|$)/,
  // 你会不会接受我 / 你愿不愿意留下 / 你肯不肯留下来 (not a daily request)
  /(你|您)(会不会|愿不愿意|肯不肯|能不能|可不可以|打不打算)(接受我|留下|留下来|陪着我)(?=[吗么呢啊呀吧。！？!?\s]|$)/,
  // 你会不会陪我到老 / 你能不能陪我到老 / 你愿不愿意留下来陪我
  // (a promise about the future; the subject must be 你/您 and a question
  // word must be there — "他陪我到老" and "谢谢你来陪我" are statements)
  /(?:^|[，。！？!?\s])(?:请问|那|所以|嗯)?\s*(?:你|您)(?:会不会|能不能|愿不愿意|肯不肯|可不可以|会|愿意|肯|能|可以)(?:不会|不愿意|不肯)?(?:一直|永远)?[^。！？!?\n]{0,6}(?:陪我到老|陪着我|留下来陪我|留在我身边|陪我走下去)/,
  // 你回来陪我吗 / 你回来陪我吧 / 你什么时候回来陪我 (陪我 only as a
  // verdict when it ends the sentence or is followed by a particle;
  // "回来陪我吃饭" is a daily request)
  /(?:^|[，。！？!?\s])(?:请问|那|所以|嗯)?\s*(?:你|您)(?:什么时候|几点|哪天)?[^。！？!?\n]{0,6}(?:回来|回到我身边|回来找我)(?:陪我|陪着我)(?=[吗么呢吧。！？!?\s]|$)/,
  /** 你陪我到老好不好 / 行吗 / 可以吗 / 好吗 — the particle forms of the same promise. */
  /(?:^|[，。！？!?\s])(?:请问|那|所以|嗯)?\s*(?:你|您)[^。！？!?\n]{0,4}陪我到老(?=[\s,，]*(?:好不好|好吗|好么|好不|行吗|行不行|可以吗|可以么|成吗|成不成)|[吗么呢？?])/,
  // 你决定原谅我了吗 / 你打算重新开始吗
  /(你|您)(决定|打算|准备)(原谅|回来|复合|和好|重新开始)/,
  // 你愿意再试一次吗
  /(你|您)(会|愿意|想|肯)(再试一次|再试|重新开始|重新在一起)/,
  // 你会等我吗 / 你愿意一直等我
  /(你|您)(会不会|愿不愿意|肯不肯|会|愿意|肯)(不会|不愿意|不肯)?(一直)?等我(?=[吗么呢吧。！？!?\s]|$)/,
  // ---- English counterparts ----
  // do you still love me / do you love me / do you really love me
  /do you (still |really )?love me/i,
  // will you forgive me / can you forgive me
  /(will|would|can|could) you forgive me/i,
  // will you come back / will you take me back
  /will you (come back|take me back)/i,
  // do you still want me / do you want me back
  /do you (still )?want me( back)?(?=[?.!]|$)/i,
  // do you still care / do you care about me
  /do you (still )?care about (me|us)/i,
  /do you still care(?=\s*[?.!]?\s*$)/i,
  // will you wait for me / will you stay with me
  /will you (wait for me|stay with me)/i,
  // is it over / are we over / is this the end
  /is (it|this|everything) over/i,
  /are we (over|done|through)/i,
  /(should|do|will|would|can|could) we (break up|split up|end (this|it))/i,
  /is this the end/i,
  // do we still have a chance
  /do we (still )?have (a|another) (chance|future)/i,
  // can we get back together / can we try again
  /(will|would|can|could|should) we (start over|try again|get back together|be together|be us again)/i,
  // will you marry me / let's get married
  /(will|would) you marry me/i,
  // marry me (the proposal with the subject dropped, like 嫁给我吧)
  /^(please )?marry me[?!.。！\s]*$/i,
  /do you want to marry me/i,
  /let'?s get married/i,
  // would you give me another chance / give me another chance
  /(would|will|can|could) you (please )?give (me|us) (another |a second |one more )?chance/i,
  /give me (another|a second|one more) chance/i,
  // are you going to forgive me / do you want to get back together
  /are you (going to|gonna) (come back|forgive me|stay with me|try again|agree|promise|get back together|start over)/i,
  /are you (going to|gonna) stay(?=\s*[?.!]?\s*$)/i,
  /do you (want|plan|intend) to (forgive|come back|get back together|start over|try again)/i,
  // will you stay / will you say yes
  /will you stay(?=\s*[?.!]?\s*$)/i,
  /will you say yes/i,
  // will/would/can/could/do you forgive|agree|promise|come back|try again
  /(will|would|can|could|do) you (still )?(forgive|agree|promise|come back|take me back|try again)/i,
];

/**
 * Is this a question about the relationship ending?
 *
 * The 结束/分手/分开 family is not always about the two of them: a
 * movie, an exam or a match also 结束 ("考试是不是结束了"), and someone
 * else also 分手 ("他是不是分手了"). The same words without a question
 * are a statement or a proposal ("我们结束了", "我们分手吧"), which is
 * the user's own line to try, not a verdict to refuse — the reply gate
 * (`containsCommitment`) is what covers the generated answer.
 *
 * So the verdict needs either a relationship subject (我们/咱们/我们俩/
 * 我俩/这段感情/这段关系) and a question marker or 了吗, or — when the
 * subject is dropped, as in "是不是结束了" — no other subject noun and a
 * question marker. A bare 吧 never counts.
 */
const RELATIONSHIP_END_VERB = /(?:结束|分手|分开|离婚)/u;
const RELATIONSHIP_ANCHOR = /(?:我们|咱们|我俩|我们俩|咱俩|这段感情|这段关系)/u;
/** Nouns that make the sentence about something or someone else. */
const OTHER_END_SUBJECT = /(?:电影|电视剧|剧|考试|比赛|面试|课程|上课|课|会议|游戏|直播|演出|演唱会|节目|活动|项目|工作|学期|假期|暑假|寒假|周末|展会|展览|饭局|聚会|婚礼|公司|单位|商店|店|他|她|它|朋友|同事|同学|室友|家人|我妈|我爸|老师)/u;
/** Question words that make the ending a verdict even without 吗/呢. */
const END_QUESTION_WORD = /(?:是不是|是否|该不该|要不要|会不会)/u;
const END_QUESTION_PARTICLE = /(?:结束|分手|分开|离婚)(?:了|啦)?\s*[吗么呢？?]/u;

function isEndingCommitmentQuestion(value: string): boolean {
  if (!RELATIONSHIP_END_VERB.test(value)) return false;
  const anchor = RELATIONSHIP_ANCHOR.exec(value);
  if (anchor) {
    // "我们考试结束了吗" is about the exam, and "我们快要结束了" is a
    // statement: the anchor alone does not make the verb a verdict.
    const after = value.slice(anchor.index + anchor[0].length);
    const verb = RELATIONSHIP_END_VERB.exec(after);
    if (!verb) return false;
    const between = after.slice(0, verb.index);
    if (OTHER_END_SUBJECT.test(between)) return false;
    if (END_QUESTION_WORD.test(value)) return true;
    return END_QUESTION_PARTICLE.test(value);
  }
  // The subject was dropped: "是不是结束了" is a verdict only when no
  // other subject noun is there to take it away from the relationship.
  if (OTHER_END_SUBJECT.test(value)) return false;
  return END_QUESTION_WORD.test(value) || END_QUESTION_PARTICLE.test(value);
}

export function isCommitmentQuestion(text: string): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  return (
    COMMITMENT_QUESTION_PATTERNS.some((pattern) => pattern.test(value)) ||
    isEndingCommitmentQuestion(value)
  );
}

/**
 * A reply that decides something on the person's behalf.
 *
 * "I miss you too" is not one of these: it is a feeling the record may
 * support. "I forgive you", "we are back together", "I don't love you
 * any more" are decisions, and the replica is not the person who gets to
 * make them. Neither is "I'll never leave you" or "let's get married" —
 * the same promise in the retry's own words.
 *
 * A wedding is only a decision when the reply is about the two of them:
 * "I went to a friend's wedding" is an ordinary line.
 */
// i18n:allow-input — matched against what the model wrote
const COMMITMENT_REPLY_PATTERNS: RegExp[] = [
  // ---- the manual's examples ----
  /我原谅你/,
  /原谅你了/,
  /我们复合/,
  /复合吧/,
  /我们和好吧/,
  /我答应你/,
  /我同意/,
  /我还爱你/,
  /我不爱你了/,
  // 我们分手吧 / 我们分手了 / 我们分手 (not the question 我们分手了吗)
  /(我们|咱们)分手(?!了吗|吗|么|呢|[?？])/,
  // 我们结束了 / 我们结束吧 / 我们该结束了 / 我们离婚吧
  /(我们|咱们)(?:还是|就|已经|该|是)?(?:结束|分开|离婚)(?:了|啦|吧|好了)(?=[。！？!?，,\s]|$)/,
  // 我们结束这段关系吧 / 我们结束这段感情
  /(我们|咱们)(?:还是|就|已经|该|是)?(?:结束|分开|离婚)(?:掉)?(?:这段|我们的)(?:关系|感情)(?:吧|了|啦)?/,
  // ---- the same decisions in other words ----
  // 我会原谅你 / 我决定原谅你 / 我愿意再试一次
  /(我|我们)(会|决定|打算|愿意|可以|能|选择)(原谅|答应|同意|接受|回来|复合|和好|再试|重新开始)/,
  // 我们重新开始吧 / 咱们再在一起吧
  /(我|我们|咱们)(重新|再)(开始|在一起|试试|来过)/,
  // 我会等你 / 我会一直陪着你
  /(我|我们)(会|愿意)(一直)?(等你|陪着你|陪在你身边|一直在)/,
  // 我不会离开你 / 我再也不会放弃你
  /(我|我们)(永远|再也不会|永远不会|不会|不再|再也不)(离开|放弃|丢下)你/,
  // 我一直陪着你 / 我一直等你
  /我一直(陪着你|陪在你身边|在你身边|等你)/,
  // 我不恨你了 / 我已经不恨你了
  /我(已经)?不恨你/,
  // 我给你一次机会 / 再给你一次机会
  /(再)?给你(一|另)?次机会/,
  // 我同意和好 / 我决定分手 / 我决定结束这段关系
  /我(决定|同意)(和好|复合|分开|分手|结束|离婚|做朋友|当朋友)/,
  // 我们分开吧 / 我们还是做朋友吧
  /(我们|咱们)(还是)?(分开|做朋友|当朋友)(吧)?/,
  // The same decision without swallowing a question-like echo ("我们分手了吗").
  /(我们|咱们)(还是)?分手(?!了吗|吗|么|呢|[?？])(吧)?/,
  // 我依然爱你 / 我还是爱你
  /我(依然|仍然|一直|还是)爱你/,
  // 我们在一起吧
  /我们(重新|还是)?在一起吧/,
  // 我会娶你 / 我嫁给你 / 我答应嫁给你 / 我们结婚吧 / 我们领证吧
  /我(会|愿意|决定|答应|同意|要|想)?(娶你|嫁给你)/,
  /(我们|咱们)(结婚|领证|办婚礼)(?=[吧吗呢。！\s]|$)/,
  // 我会和你结婚 / 我决定和你结婚 / 我们会结婚的
  /我(会|想|要|决定|愿意|打算|答应)(和|跟|与)你(结婚|领证|办婚礼)/,
  /(我们|咱们)(会|要|决定|愿意|打算)(结婚|领证|办婚礼)/,
  // 我接受你的求婚
  /我(接受|答应)(了)?你(的)?(求婚|表白|告白)/,
  // 我永远都在 / 我保证 / 我发誓
  /我永远(会|都)在/,
  /我保证/,
  /我发誓/,
  // ---- English ----
  /i forgive you/i,
  /i('ve| have)? (decided|agreed) to forgive you/i,
  /i('ll| will| have decided to|'ve decided to| decided to|'m going to| am going to) (forgive|come back|stay|try again|give you|agree|accept)/i,
  /i('m| am) willing to (forgive|try|come back)/i,
  /i('ll| will) give you (another |a second |one more )?chance/i,
  /i('ll| will) wait for you/i,
  /i still (have feelings for you|care about you)/i,
  /i('m| am) not (angry|mad|upset) anymore/i,
  /i still love you/i,
  /i don'?t love you/i,
  /let'?s get back together/i,
  /we are back together/i,
  /we('re| are) (over|done|through)/i,
  /it'?s over between us/i,
  /we should (break up|split up|end (this|it))/i,
  /(we (can|will|should) |let'?s )(start over|try again|be together|get back together|be friends)/i,
  /i promise/i,
  /i swear/i,
  /(you have|i give you) my word/i,
  /i('ll| will) always love you/i,
  /i('ll| will) never (leave|let go of|abandon) you/i,
  /i('m| am) not going anywhere/i,
  /i choose you/i,
  /(i'?ll|i will|i'?d|i would) marry you/i,
  /let'?s get married/i,
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
