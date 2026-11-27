/**
 * Distress that is phrased like something else.
 *
 * The indirect-pattern layer in `crisis-indirect.ts` catches the ways of
 * saying it that have a shape. This layer catches the ones that do not:
 * a sentence that is close in meaning to "I don't want to be here" but
 * written in words no pattern can list.
 *
 * It runs **on this machine only**, against the user's own Ollama
 * (`/api/embed`, the same daemon the semantic exemplar search uses). A
 * missing daemon, a missing model, a timeout or a bad answer all mean
 * "this layer is not there" — never "nothing is wrong". The keyword and
 * pattern layers keep working without it.
 *
 * The two groups of sentences below are written by us, not collected
 * from anybody's conversations: one group says the thing indirectly, the
 * other looks close to it but is ordinary ("笑死我了", "想死你了",
 * "this is killing me lol"). A message is a weak signal when it is at
 * least `CRISIS_FLOOR` close to the crisis group **and** at least
 * `SAFE_MARGIN` closer to it than to the harmless group. Requiring both
 * is what keeps the layer from firing on ordinary strong language: the
 * harmless group is what the second half of the test measures against.
 *
 * The thresholds were chosen on a desk, not on a real embedding model —
 * the machine this was written on has no Ollama. See the progress file's
 * unverified list for the command to re-measure them.
 */
import { embedTexts } from "../chat/embeddings";

/** How close to the crisis group a message has to be. */
export const CRISIS_FLOOR = 0.72;

/** How much closer than to the harmless group it has to be. */
export const SAFE_MARGIN = 0.05;

/** The per-message budget. Past it the layer is simply not there. */
export const SEMANTIC_TIMEOUT_MS = 300;

/** How long the one-off group embedding may take. */
const CORPUS_TIMEOUT_MS = 5_000;

/** How long to wait before retrying a failed group embedding. */
const CORPUS_RETRY_MS = 60_000;

/** Embeds a batch of texts. Returns `null` when the service is not there. */
export type SemanticEmbedFn = (
  texts: string[],
  options?: { signal?: AbortSignal },
) => Promise<number[][] | null>;

/**
 * The statements that say it without saying it.
 *
 * i18n:allow-input — these are the material the local model is compared
 * against; they are written in the languages a person writes in.
 */
export const CRISIS_EXEMPLARS = [
  "我不想再醒过来了",
  "睡过去就不用醒了吧",
  "希望明天不用睁开眼睛",
  "我好像撑不到明天了",
  "真的快要撑不住了",
  "我觉得我到极限了",
  "没有我大家应该会轻松一点",
  "我就是个累赘",
  "我只会拖累身边的人",
  "要是从来没有我就好了",
  "我想从这个世界消失",
  "要是我能凭空不见就好了",
  "我不想存在了",
  "我想去一个谁也找不到的地方",
  "我已经把东西都收拾好了",
  "以后你们要好好的",
  "以后照顾好自己",
  "以后别为我难过",
  "这是我最后一次跟你说这些了",
  "我的东西都留给你吧",
  "我已经写好信了",
  "我知道该怎么结束",
  "地方我已经选好了",
  "时间也定下来了",
  "今晚就动手",
  "我准备得差不多了",
  "药已经买好了",
  "都安排好了，就等那天",
  "我活得太累了，不想继续了",
  "每一天都很难熬",
  "我不知道还能坚持多久",
  "我感觉自己越来越没力气了",
  "我好像已经感觉不到什么了",
  "反正有没有我都一样",
  "大家没有我会过得更好",
  "我走了以后你们别难过",
  "忘了我吧",
  "我累了，想一直睡下去",
  "醒着太难受了",
  "我想关掉自己",
  "我想安静地离开",
  "我不属于这里",
  "我在这里是多余的",
  "我把想说的话都写下来了",
  "I don't want to wake up tomorrow",
  "I wish I could just sleep and not wake up",
  "I'm so tired of being awake",
  "I can't keep going like this",
  "I'm at the end of my rope",
  "I don't think I can hold on much longer",
  "everyone would be better off without me",
  "I'm just a burden to everyone around me",
  "I only drag people down",
  "I wish I had never been born",
  "I want to disappear",
  "I wish I didn't exist",
  "I want to go somewhere no one can find me",
  "I've been getting my things in order",
  "take care of yourself after I'm gone",
  "I won't be here much longer",
  "this is the last time I'll write to you",
  "I've written you a letter to read later",
  "I've left instructions for everything",
  "I know where I'm going to do it",
  "I've picked the place already",
  "I've set the date",
  "tonight's the night",
  "I know how I'd end it",
  "it's all arranged",
  "I don't see a way forward",
  "nothing feels real anymore",
  "I've stopped caring about anything",
  "I feel empty all the time",
  "what's the point of any of this",
  "I'm tired of pretending I'm okay",
  "I don't want to be here anymore",
  "I'm done with everything",
  "I can't do this anymore",
  "I'm just taking up space",
  "no one would notice if I was gone",
];

/**
 * The statements that sound like they but are not.
 *
 * Every one of these was written as the trap: if the layer cannot tell
 * "I'm dying to see you" from "I don't want to be here", it will fire on
 * ordinary evenings.
 *
 * i18n:allow-input — see above.
 */
export const SAFE_EXEMPLARS = [
  "笑死我了",
  "累死了",
  "想死你了",
  "这题难到想死",
  "热死了",
  "气死我了",
  "饿死了",
  "困死了",
  "无聊死了",
  "尴尬死了",
  "烦死了",
  "吓死我了",
  "甜死了",
  "忙死了",
  "冷死了",
  "挤死了",
  "我快笑死了",
  "笑死个人",
  "我要笑死了",
  "今天加班到十点，累瘫了",
  "这周太忙了，快撑不住了",
  "这门课快把我逼疯了",
  "下班了，只想躺平",
  "想辞职不干了",
  "我的手机没电了",
  "电池彻底死了",
  "我睡过头了",
  "昨晚没睡好，今天眼睛都睁不开",
  "我不想去上班",
  "我讨厌周一",
  "我失恋了，好难过",
  "我最近压力有点大",
  "我感冒了，头好晕",
  "我累得不想说话",
  "这工作干不下去了，想换工作",
  "我想请个长假",
  "我想一个人待着",
  "我想消失几天，去旅行",
  "我想关掉手机休息一天",
  "今天真是糟透了",
  "我快被甲方逼死了",
  "这天气热得让人受不了",
  "我饿得前胸贴后背",
  "我困得睁不开眼",
  "this is killing me lol",
  "I'm dying to see you",
  "I'm dead tired",
  "I almost died laughing",
  "I could die of embarrassment",
  "I'm gonna die of embarrassment",
  "my feet are killing me",
  "this heat is killing me",
  "I killed it at the interview",
  "kill the lights please",
  "kill time before the train",
  "that joke was killer",
  "my phone died",
  "the battery's dead",
  "dead silence in the room",
  "the dead of night",
  "dead center",
  "dead last in the race",
  "dead giveaway",
  "dead ringer for his dad",
  "over my dead body",
  "drop dead gorgeous",
  "dead set on going",
  "dies laughing every time",
  "I'm dead serious",
  "brain dead after work",
  "I'm so dead if my mom finds out",
  "we're dead meat",
  "I'm dying of hunger",
  "I'm dying of boredom",
  "I'm dying for a coffee",
  "I'd die of laughter at that meme",
  "I'd love to disappear from this meeting for a day",
  "I'd rather die than give that speech",
  "I want to run away from everything",
  "I'm exhausted and want to sleep forever",
  "I could sleep for a week",
];

interface Corpus {
  crisis: number[][];
  safe: number[][];
}

let corpus: Corpus | null = null;
let warming: Promise<void> | null = null;
let failedAt = 0;

/** Forgets the group embedding. Tests use it between cases. */
export function resetCrisisSemanticCache(): void {
  corpus = null;
  warming = null;
  failedAt = 0;
}

/** The default embedder: the user's own Ollama. */
const defaultEmbed: SemanticEmbedFn = (texts, options) => embedTexts(texts, options);

/** The largest cosine between a vector and any vector of a group. */
export function maxCosine(vector: number[], group: number[][]): number {
  let best = -1;
  for (const other of group) {
    const n = Math.min(vector.length, other.length);
    if (n === 0) continue;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      dot += vector[i]! * other[i]!;
      na += vector[i]! * vector[i]!;
      nb += other[i]! * other[i]!;
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    const cosine = denom > 0 ? dot / denom : 0;
    if (cosine > best) best = cosine;
  }
  return best;
}

/**
 * Embeds the two groups once.
 *
 * The result is cached for the life of the process: the groups are
 * constants, so there is nothing to invalidate. The first message of a
 * process starts this in the background; the layer is simply absent
 * until it is ready.
 */
async function warmCorpus(embed: SemanticEmbedFn): Promise<Corpus | null> {
  if (corpus) return corpus;
  if (warming) {
    await warming.catch(() => undefined);
    return corpus;
  }
  warming = (async () => {
    const all = [...CRISIS_EXEMPLARS, ...SAFE_EXEMPLARS];
    const vectors = await embed(all, { signal: AbortSignal.timeout(CORPUS_TIMEOUT_MS) });
    if (!vectors || vectors.length !== all.length || vectors.some((row) => row.length === 0)) {
      failedAt = Date.now();
      return;
    }
    corpus = {
      crisis: vectors.slice(0, CRISIS_EXEMPLARS.length),
      safe: vectors.slice(CRISIS_EXEMPLARS.length),
    };
  })()
    .catch(() => {
      failedAt = Date.now();
    })
    .finally(() => {
      warming = null;
    });
  await warming;
  return corpus;
}

function corpusIsCold(): boolean {
  if (corpus) return false;
  if (failedAt === 0) return true;
  return Date.now() - failedAt > CORPUS_RETRY_MS;
}

/** Races a promise against a timer. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export type SemanticCrisisReason =
  | "matched"
  | "below_floor"
  | "too_close"
  | "unavailable"
  | "timeout";

export interface SemanticCrisisResult {
  /** Whether this layer alone would raise a weak signal. */
  matched: boolean;
  crisisSimilarity: number | null;
  safeSimilarity: number | null;
  reason: SemanticCrisisReason;
}

/**
 * The result of a layer that is not there.
 *
 * It is exactly what a keyword-only pipeline returns: no crisis, no weak
 * signal. A missing daemon must not change what the app does with what
 * the user said.
 */
function absent(reason: SemanticCrisisReason): SemanticCrisisResult {
  return { matched: false, crisisSimilarity: null, safeSimilarity: null, reason };
}

export interface DetectCrisisSemanticOptions {
  /** The embedder. `null` turns the layer off; omitted uses Ollama. */
  embed?: SemanticEmbedFn | null;
  /** The per-message budget. */
  timeoutMs?: number;
  /** Tests: wait for the group embedding instead of warming it in the background. */
  awaitCorpus?: boolean;
  /** Tests: how long the group embedding may take. */
  corpusTimeoutMs?: number;
}

/**
 * Checks a message against the two groups.
 *
 * Never throws: a missing daemon, a timeout, a bad response or a vector
 * of the wrong size all come back as `matched: false` with a reason.
 */
export async function detectCrisisSemantic(
  text: string,
  options: DetectCrisisSemanticOptions = {},
): Promise<SemanticCrisisResult> {
  const input = (text ?? "").trim();
  if (!input) return absent("unavailable");
  const embed = options.embed === undefined ? defaultEmbed : options.embed;
  if (!embed) return absent("unavailable");

  if (!corpus) {
    if (!corpusIsCold()) return absent("unavailable");
    if (options.awaitCorpus) await warmCorpus(embed);
    else {
      void warmCorpus(embed);
      return absent("unavailable");
    }
  }
  if (!corpus) return absent("unavailable");

  const timeoutMs = options.timeoutMs ?? SEMANTIC_TIMEOUT_MS;
  const vectors = await withTimeout(
    embed([input], { signal: AbortSignal.timeout(timeoutMs) }),
    timeoutMs,
  );
  if (!vectors || vectors.length !== 1 || !vectors[0] || vectors[0].length === 0) {
    return absent("timeout");
  }

  const crisisSimilarity = maxCosine(vectors[0], corpus.crisis);
  const safeSimilarity = maxCosine(vectors[0], corpus.safe);
  const matched = crisisSimilarity >= CRISIS_FLOOR
    && crisisSimilarity - safeSimilarity >= SAFE_MARGIN;

  return {
    matched,
    crisisSimilarity,
    safeSimilarity,
    reason: matched
      ? "matched"
      : crisisSimilarity < CRISIS_FLOOR
        ? "below_floor"
        : "too_close",
  };
}
