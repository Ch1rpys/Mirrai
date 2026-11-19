/**
 * Whether a name or a topic actually shows up in a line.
 *
 * A two-character name is specific enough to find with a substring.
 * A single character is not: 「海」sits inside 「上海」, and 「强」sits
 * inside 「坚强」. The line is segmented into words, and a single
 * character only counts when it is a word of its own. A degree adverb
 * in front of it («他好强») makes it an adjective, not the person; a
 * name suffix after it («海子») makes it part of a longer name.
 */

// i18n:allow-input — words in what people type, where a single character is not the term
const DEGREE_OR_AUX = new Set([
  "好",
  "很",
  "太",
  "真",
  "最",
  "挺",
  "够",
  "更",
  "越",
  "超",
  "极",
  "不",
  "没",
  "别",
  "要",
  "争",
  "逞",
  "自",
  "富",
  "加",
  "增",
  "顽",
  "刚",
  "高",
  "特",
  "非",
  "十",
  "分",
  "比较",
  "非常",
  "特别",
  "十分",
  "有点",
  "有些",
  "极其",
]);

// i18n:allow-input — verbs that take the character as their object («看海»)
const VERB_OBJECT_HEADS = new Set([
  "看",
  "去",
  "来",
  "爱",
  "怕",
  "想",
  "吃",
  "喝",
  "买",
  "养",
  "喂",
  "恨",
  "有",
  "找",
  "等",
  "追",
  "骂",
  "夸",
  "抱",
  "亲",
  "打",
  "救",
  "帮",
  "陪",
  "给",
  "学",
  "教",
  "用",
  "穿",
  "戴",
  "听",
  "闻",
  "摸",
  "玩",
  "做",
  "干",
  "搞",
  "修",
  "洗",
  "种",
  "读",
]);

// i18n:allow-input — suffixes that turn a single character into part of a longer name
const NAME_SUFFIXES = new Set([
  "子",
  "王",
  "哥",
  "姐",
  "叔",
  "姨",
  "总",
  "爷",
  "少",
  "仔",
  "儿",
]);

let zhSegmenter: Intl.Segmenter | null | undefined;

function segmenter(): Intl.Segmenter | null {
  if (zhSegmenter === undefined) {
    zhSegmenter = typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("zh", { granularity: "word" })
      : null;
  }
  return zhSegmenter;
}

function containsSingleCharacter(haystack: string, needle: string): boolean {
  const segment = segmenter();
  if (!segment) return haystack.includes(needle);
  const words = [...segment.segment(haystack)].map((part) => part.segment);
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    /**
     * A verb and its one-character object can be one word to the
     * segmenter («看海»). The character is the object, so it counts.
     */
    if (
      word.length === 2
      && word.endsWith(needle)
      && VERB_OBJECT_HEADS.has(word.charAt(0))
    ) {
      return true;
    }
    if (word !== needle) continue;
    const before = words[index - 1] ?? "";
    const after = words[index + 1] ?? "";
    if (DEGREE_OR_AUX.has(before)) continue;
    if (NAME_SUFFIXES.has(after)) continue;
    return true;
  }
  return false;
}

export function containsTerm(text: string, term: string): boolean {
  const needle = term.trim();
  const haystack = String(text ?? "");
  if (!needle || !haystack) return false;
  if ([...needle].length >= 2) return haystack.includes(needle);
  return containsSingleCharacter(haystack, needle);
}
