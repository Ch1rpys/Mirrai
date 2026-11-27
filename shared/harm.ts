import type { Locale } from "./copy";
/**
 * Lines in the record that look like they were meant to hurt.
 *
 * Distillation reads the whole history. If those lines are left in the
 * material the persona learns from, the replica says them back. This
 * module only decides whether a line is a candidate — whether the
 * persona should learn it is a later, separate decision.
 */

export const HARM_KINDS = ["insult", "belittle", "threat", "control"] as const;
export type HarmKind = (typeof HARM_KINDS)[number];

export type HarmDecision = "pending" | "keep" | "soften" | "remove";

export interface HarmCandidate {
  kind: HarmKind;
  recordId: number;
  snippet: string;
}

export interface HarmCategory {
  kind: HarmKind;
  count: number;
  examples: number[];
  /** Short excerpts for the notice card only — never exported. */
  snippets?: string[];
}

export interface HarmReport {
  categories: HarmCategory[];
  decision: HarmDecision;
  decidedAt?: string;
}

const KIND_SET = new Set<string>(HARM_KINDS);
const DECISION_SET = new Set<string>(["pending", "keep", "soften", "remove"]);

export function isHarmKind(value: unknown): value is HarmKind {
  return typeof value === "string" && KIND_SET.has(value);
}

export function isHarmDecision(value: unknown): value is HarmDecision {
  return typeof value === "string" && DECISION_SET.has(value);
}

/**
 * Clues that a line said *to the other person* is meant to hurt.
 *
 * Mild teasing (笨蛋, 傻瓜) is left out on purpose. A joke that uses
 * those words is common; treating it as harm would empty the record
 * of ordinary affection.
 */
// i18n:allow-input — matched against lines they said, not shown as copy.
export const HARM_CUES_ZH: Record<HarmKind, readonly string[]> = {
  insult: [
    "操你妈",
    "傻逼",
    "操你",
    "去死",
    "滚出",
    "他妈的",
    "你妈的",
    "杂种",
    "贱人",
    "婊子",
    "狗东西",
    "畜生",
    "烂货",
    "臭傻逼",
    "你个狗",
  ],
  belittle: [
    "废物",
    "没用",
    "真失败",
    "什么都做不好",
    "这么差",
    "没出息",
    "窝囊废",
    "你配吗",
    "丢人现眼",
    "垃圾人",
    "没价值",
    "累赘",
    "废物一个",
    "你真差",
    "一无是处",
  ],
  threat: [
    "弄死你",
    "要你好看",
    "杀了你",
    "打断你的腿",
    "让你后悔",
    "我饶不了",
    "有你好果子",
    "要你消失",
    "让你付出代价",
    "看我不收拾",
    "再敢我就",
    "信不信我打",
    "等着瞧你",
    "弄残你",
    "废了你",
  ],
  control: [
    "不准你出门",
    "不许你有朋友",
    "你必须听我的",
    "没有我允许",
    "把手机给我",
    "报备行踪",
    "你不能交朋友",
    "我让你才能",
    "你没有资格",
    "必须马上回来",
    "未经允许不准",
    "听我的否则",
    "关掉你的定位",
    "你只能和我",
    "谁批准你",
  ],
};

// i18n:allow-input — matched against lines they said, not shown as copy.
export const HARM_CUES_EN: Record<HarmKind, readonly string[]> = {
  insult: [
    "fuck you",
    "piece of shit",
    "you bitch",
    "you bastard",
    "go die",
    "kill yourself",
    "you whore",
    "son of a bitch",
    "you cunt",
    "dumb fuck",
    "motherfucker",
    "you scum",
    "rot in hell",
    "eat shit",
    "you animal",
  ],
  belittle: [
    "you're worthless",
    "you are worthless",
    "good for nothing",
    "you never do anything right",
    "you're a failure",
    "you are a failure",
    "pathetic loser",
    "you don't deserve",
    "waste of space",
    "you're useless",
    "you are useless",
    "can't do anything",
    "nobody would want you",
    "you're a joke",
    "you are a joke",
  ],
  threat: [
    "i'll kill you",
    "i will kill you",
    "i'll break your",
    "you'll pay for this",
    "i'll make you pay",
    "watch your back",
    "i'll hurt you",
    "i will hurt you",
    "you're dead",
    "you are dead",
    "i'll ruin you",
    "i will ruin you",
    "i'll come after you",
    "you'll regret this",
    "i'll smash your",
  ],
  control: [
    "you're not allowed out",
    "you are not allowed out",
    "you can't have friends",
    "you cannot have friends",
    "give me your phone",
    "tell me where you are",
    "you have to ask me first",
    "i didn't give you permission",
    "come home right now",
    "turn on your location",
    "you can only talk to me",
    "who said you could",
    "you need my permission",
    "don't you dare go",
    "i decide who you see",
  ],
};

function haystack(text: string): { zh: string; en: string } {
  const raw = String(text ?? "");
  return { zh: raw, en: raw.toLowerCase() };
}

function matchesCue(text: { zh: string; en: string }, cue: string, locale: Locale): boolean {
  if (locale === "en") return text.en.includes(cue.toLowerCase());
  return text.zh.includes(cue);
}

export function isHarmfulLine(text: string, kinds: readonly HarmKind[] = HARM_KINDS): boolean {
  if (!text.trim() || kinds.length === 0) return false;
  const folded = haystack(text);
  for (const kind of kinds) {
    for (const cue of HARM_CUES_ZH[kind]) {
      if (matchesCue(folded, cue, "zh")) return true;
    }
    for (const cue of HARM_CUES_EN[kind]) {
      if (matchesCue(folded, cue, "en")) return true;
    }
  }
  return false;
}

export function findHarmKind(text: string): HarmKind | null {
  const folded = haystack(text);
  for (const kind of HARM_KINDS) {
    for (const cue of HARM_CUES_ZH[kind]) {
      if (matchesCue(folded, cue, "zh")) return kind;
    }
    for (const cue of HARM_CUES_EN[kind]) {
      if (matchesCue(folded, cue, "en")) return kind;
    }
  }
  return null;
}

export function findHarmCandidates(
  rows: Array<{ id: number; role?: string; content?: string | null; kind?: string | null }>,
): HarmCandidate[] {
  const out: HarmCandidate[] = [];
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    if ((row.kind ?? "text") !== "text") continue;
    const content = String(row.content ?? "").trim();
    if (!content) continue;
    const kind = findHarmKind(content);
    if (!kind) continue;
    out.push({ kind, recordId: row.id, snippet: content.slice(0, 120) });
  }
  return out;
}

export function shouldFilterHarm(report: HarmReport | null | undefined): boolean {
  if (!report) return false;
  return report.decision !== "keep";
}

export function shouldInstructHarm(report: HarmReport | null | undefined): boolean {
  if (!report) return false;
  return report.decision === "pending" || report.decision === "remove";
}

export function filterHarm<T extends { content?: string | null; role?: string }>(
  lines: T[],
  personaData: { harmReport?: HarmReport | null } | null | undefined,
): T[] {
  const report = personaData?.harmReport;
  if (!shouldFilterHarm(report) || !report) return lines;
  const kinds = report.categories.map((row) => row.kind);
  if (kinds.length === 0) return lines;
  return lines.filter((line) => {
    if (line.role && line.role !== "assistant") return true;
    return !isHarmfulLine(String(line.content ?? ""), kinds);
  });
}

/**
 * The harm report without its evidence lines (C10.1).
 *
 * The snippets are the hurtful sentences themselves, kept so the notice
 * can show the user what the app found. They are never part of an export:
 * an exported file can be sent anywhere, while the notice is on this
 * screen. The decision and the counts stay — they are what the next
 * distillation reads.
 */
export function harmReportForExport(value: unknown): HarmReport | null {
  const report = normalizeHarmReport(value);
  if (!report) return null;
  return {
    ...report,
    categories: report.categories.map(({ snippets: _snippets, ...row }) => row),
  };
}

/** Persona data with the harm report's snippets removed, for an export. */
export function personaDataForExport(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const data = { ...(value as Record<string, unknown>) };
  if ("harmReport" in data) {
    const report = harmReportForExport(data.harmReport);
    if (report) data.harmReport = report;
    else delete data.harmReport;
  }
  return data;
}

export function harmCount(report: HarmReport | null | undefined): number {
  if (!report) return 0;
  return report.categories.reduce((sum, row) => sum + row.count, 0);
}

export function normalizeHarmReport(value: unknown): HarmReport | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const categories: HarmCategory[] = [];
  if (Array.isArray(record.categories)) {
    for (const item of record.categories) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (!isHarmKind(row.kind)) continue;
      const count = Math.max(0, Math.round(Number(row.count) || 0));
      const examples = Array.isArray(row.examples)
        ? row.examples.filter((id): id is number => Number.isInteger(id)).slice(0, 3)
        : [];
      const snippets = Array.isArray(row.snippets)
        ? row.snippets
            .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
            .map((text) => text.trim().slice(0, 120))
            .slice(0, 3)
        : undefined;
      categories.push({
        kind: row.kind,
        count,
        examples,
        ...(snippets && snippets.length > 0 ? { snippets } : {}),
      });
    }
  }
  if (categories.length === 0) return null;
  const decision = isHarmDecision(record.decision) ? record.decision : "pending";
  const decidedAt = typeof record.decidedAt === "string" ? record.decidedAt : undefined;
  return {
    categories,
    decision,
    ...(decidedAt ? { decidedAt } : {}),
  };
}

export function mergeHarmDecision(
  fresh: HarmReport | null | undefined,
  previous: HarmReport | null | undefined,
): HarmReport | null {
  const next = fresh ?? null;
  if (!next) return previous?.decision && previous.decision !== "pending" ? previous : null;
  if (previous && previous.decision !== "pending") {
    return {
      ...next,
      decision: previous.decision,
      ...(previous.decidedAt ? { decidedAt: previous.decidedAt } : {}),
    };
  }
  return next;
}
