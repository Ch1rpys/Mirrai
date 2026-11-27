import { intimacyLevelLabel } from "@shared/intimacy";
import { normalizePersonaData } from "./persona-schema";
import { describeFingerprint } from "@shared/fingerprint-prose";
import { normalizeMicroRules } from "@shared/micro-rules";
import { normalizeStances } from "@shared/stances";
import { normalizePeople } from "@shared/people";
import { normalizeLexicon, collectLexiconCandidates, type LexiconRow } from "@shared/lexicon";
import { normalizeLifeEvents } from "@shared/life-events";
import { normalizeTriggers, normalizeConflictProfile } from "@shared/conflicts";
import { normalizeRoutine } from "@shared/routine-profile";


const EMOTION_COLORS: Record<string, string> = {
  warm: "#7CB69D", playful: "#F59E0B", nostalgic: "#8B5CF6",
  melancholy: "#6B7280", happy: "#EF4444", distant: "#3B82F6",
};

/**
 * The export's own words.
 *
 * The HTML export was hardcoded Chinese, so an English-speaking user
 * downloaded a keepsake they could not read. The wording follows the
 * language of the export.
 */
const EMOTION_LABELS: Record<string, { zh: string; en: string }> = {
  warm: { zh: "🌸 温柔", en: "🌸 Warm" },
  playful: { zh: "😄 俏皮", en: "😄 Playful" },
  nostalgic: { zh: "🌙 思念", en: "🌙 Nostalgic" },
  melancholy: { zh: "🌧️ 忧郁", en: "🌧️ Melancholy" },
  happy: { zh: "✨ 开心", en: "✨ Happy" },
  distant: { zh: "❄️ 疏离", en: "❄️ Distant" },
};

const COPY = {
  zh: {
    milestones: "记忆里程碑",
    events: "关系大事记",
    diaries: "对话日记",
    emotions: "情感时间线",
    letter: "告别信",
    letters: "信",
    transcript: "对话记录",
    milestone: "🏆 里程碑",
    anniversary: "💝 纪念日",
    memory: "💭 记忆",
    intimacy: "亲密度",
    messageCount: "消息",
    memoryCount: "记忆",
    exportedOn: "导出于",
    noMessages: "暂无消息",
    /** What kind of letter a row is. */
    letterNote: "（等 TA 回来再说）",
    letterKept: "（只写下来了，没有寄出）",
    letterWaiting: "（已寄出，等回信）",
    letterAnswered: "（已收到回信）",
    /**
     * The note under the diaries.
     *
     * It was missing from the Chinese table — so the export of a
     * persona with more than ten diaries threw, and the user got an
     * error and no file at all. The English table had it.
     */
    diaryMore: "（只显示最近 {shown} 篇，共 {total} 篇）",
  },
  en: {
    milestones: "Milestones",
    events: "The moments you marked",
    diaries: "Diaries",
    emotions: "Emotional timeline",
    letter: "The farewell letter",
    letters: "Letters",
    transcript: "Conversation",
    milestone: "🏆 Milestone",
    anniversary: "💝 Anniversary",
    memory: "💭 Memory",
    intimacy: "Intimacy",
    messageCount: "messages",
    memoryCount: "memories",
    exportedOn: "Exported on",
    noMessages: "No messages",
    diaryMore: "(the {shown} most recent of {total})",
    letterNote: "(a note for later)",
    letterKept: "(kept — never sent)",
    letterWaiting: "(sent — waiting for a reply)",
    letterAnswered: "(answered)",
  },
} as const;

type ExportLocale = keyof typeof COPY;

const EMOTION_Y: Record<string, number> = {
  distant: 1, melancholy: 2, nostalgic: 3, warm: 4, playful: 5, happy: 6,
};

interface ExportParams {
  persona: {
    name: string;
    relationshipDesc?: string | null;
    createdAt: Date;
    /** The farewell letter, when the persona has graduated. */
    farewellLetter?: string | null;
    graduatedAt?: Date | null;
  };
  messages: Array<{ role: string; content: string; emotionalState: string | null; createdAt: Date; messageType?: string | null }>;
  memories: Array<{ title: string; description?: string | null; category: string; date?: string | null; createdAt: Date }>;
  emotionSnapshots: Array<{ emotionalState: string; messageCount: number; date: string; createdAt: Date }>;
  diaryEntries: Array<{ date: string; summary: string | null; reflection?: string | null }>;
  /**
   * The relationship events.
   *
   * They were missing from the per-persona export — so the keepsake of
   * a relationship had the conversations and the memories and none of
   * the moments the user marked. The "export everything" bundle had
   * them; the one from the chat page did not.
   */
  events?: Array<{
    kind: string;
    title: string;
    detail?: string | null;
    happenedAt: Date;
  }>;
  /** The letters — what was written, and what came back. */
  letters?: Array<{
    body: string;
    kind: string;
    status: string;
    replyText?: string | null;
    repliedAt?: Date | null;
    createdAt: Date;
  }>;
  intimacy: { score: number; level: string };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(d: Date | string, locale: ExportLocale = "zh"): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function formatTime(d: Date | string, locale: ExportLocale = "zh"): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString(locale === "en" ? "en-US" : "zh-CN", {
    hour: "2-digit", minute: "2-digit",
  });
}

function buildEmotionSVG(
  snapshots: ExportParams["emotionSnapshots"],
  locale: ExportLocale = "zh",
): string {
  if (snapshots.length < 2) return "";
  const W = 700, H = 200, PAD = 40;
  const plotW = W - PAD * 2, plotH = H - PAD * 2;
  const step = plotW / Math.max(snapshots.length - 1, 1);

  const points = snapshots.map((s, i) => {
    const x = PAD + i * step;
    const y = PAD + plotH - ((EMOTION_Y[s.emotionalState] || 4) - 1) / 5 * plotH;
    return { x, y, state: s.emotionalState, date: s.date };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const dots = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${EMOTION_COLORS[p.state] || "#999"}" />
     <title>${escapeHtml(p.date)}: ${escapeHtml(EMOTION_LABELS[p.state]?.[locale] || p.state)}</title>`
  ).join("\n");

  const yLabels = Object.entries(EMOTION_Y).map(([state, val]) => {
    const y = PAD + plotH - (val - 1) / 5 * plotH;
    return `<text x="${PAD - 5}" y="${y + 4}" text-anchor="end" font-size="11" fill="#888">${EMOTION_LABELS[state]?.[locale] || state}</text>`;
  }).join("\n");

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:700px;height:auto">
    <polyline points="${polyline}" fill="none" stroke="#7CB69D" stroke-width="2" opacity="0.5"/>
    ${dots}
    ${yLabels}
    <text x="${PAD}" y="${H - 5}" font-size="10" fill="#aaa">${escapeHtml(snapshots[0]?.date || "")}</text>
    <text x="${W - PAD}" y="${H - 5}" text-anchor="end" font-size="10" fill="#aaa">${escapeHtml(snapshots[snapshots.length - 1]?.date || "")}</text>
  </svg>`;
}

export function generateChatExportHTML(
  params: ExportParams,
  locale: ExportLocale = "zh",
): string {
  const { persona, messages, memories, emotionSnapshots, diaryEntries, intimacy } = params;
  const copy = COPY[locale];
  const dateRange = messages.length > 0
    ? `${formatDate(messages[0].createdAt, locale)} — ${formatDate(messages[messages.length - 1].createdAt, locale)}`
    : copy.noMessages;

  const grouped = new Map<string, typeof messages>();
  for (const m of messages) {
    const day = formatDate(m.createdAt, locale);
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(m);
  }

  const messagesHtml = Array.from(grouped.entries()).map(([day, msgs]) => {
    const bubbles = msgs.map(m => {
      const isUser = m.role === "user";
      const emotionBadge = !isUser && m.emotionalState
        ? `<span class="badge" style="background:${EMOTION_COLORS[m.emotionalState] || "#999"}20;color:${EMOTION_COLORS[m.emotionalState] || "#999"}">${EMOTION_LABELS[m.emotionalState]?.[locale] || ""}</span>`
        : "";
      return `<div class="msg ${isUser ? "msg-user" : "msg-ai"}">
        ${emotionBadge}
        <div class="bubble ${isUser ? "bubble-user" : "bubble-ai"}">${escapeHtml(m.content)}</div>
        <span class="time">${formatTime(m.createdAt, locale)}</span>
      </div>`;
    }).join("\n");
    return `<div class="day-group"><div class="day-label">${day}</div>${bubbles}</div>`;
  }).join("\n");

  const memoriesHtml = memories.length > 0 ? `<section class="section">
    <h2>${copy.milestones}</h2>
    <div class="memories">${memories.map(m => `<div class="memory-card">
      <span class="mem-cat">${m.category === "milestone" ? copy.milestone : m.category === "anniversary" ? copy.anniversary : copy.memory}</span>
      ${m.date ? `<span class="mem-date">${escapeHtml(m.date)}</span>` : ""}
      <p class="mem-title">${escapeHtml(m.title)}</p>
      ${m.description ? `<p class="mem-desc">${escapeHtml(m.description)}</p>` : ""}
    </div>`).join("\n")}</div>
  </section>` : "";

  /**
   * The newest diaries.
   *
   * The entries arrive oldest first, and the export took the first ten
   * of them — so a user with forty-five diaries got the first ten days
   * ever diarised and nothing about the last thirty-five. No count, no
   * marker: the file simply did not have them.
   *
   * And the sibling export (the Markdown one) has all of them — so the
   * two "export my data" buttons disagreed with each other.
   */
  const shownDiaries = diaryEntries.slice(-10);
  const diaryHtml = diaryEntries.length > 0 ? `<section class="section">
    <h2>${copy.diaries}</h2>
    ${diaryEntries.length > shownDiaries.length
      ? `<p class="section-note">${copy.diaryMore.replace("{shown}", String(shownDiaries.length)).replace("{total}", String(diaryEntries.length))}</p>`
      : ""}
    ${shownDiaries.map(d => `<div class="diary-entry">
      <span class="diary-date">${escapeHtml(d.date)}</span>
      ${d.summary ? `<p>${escapeHtml(d.summary)}</p>` : ""}
      ${d.reflection ? `<p class="reflection">${escapeHtml(d.reflection)}</p>` : ""}
    </div>`).join("\n")}
  </section>` : "";

  const emotionSvg = buildEmotionSVG(emotionSnapshots, locale);
  const emotionSection = emotionSvg ? `<section class="section">
    <h2>${copy.emotions}</h2>
    ${emotionSvg}
  </section>` : "";

  // The farewell letter is the one artefact the graduation mechanism
  // produces, and it used to be reachable only online — waking the persona
  // destroyed it, and the export left it out. It belongs in the keepsake.
  // The letters. They are the artefact somebody would most want to keep:
  // what was written at two in the morning, and the reply that came a
  // day later.
  const lettersHtml = (params.letters ?? []).length > 0 ? `<section class="section">
    <h2>${copy.letters}</h2>
    ${(params.letters ?? []).map((l) => `<div class="diary-entry">
      <span class="diary-date">${formatDate(l.createdAt, locale)}</span>
      ${
      /**
       * What kind of letter it was.
       *
       * Every row was rendered the same way — so a note for later looked
       * like a letter, and a letter that was kept (and never sent)
       * looked like one that had been answered. The Markdown export
       * marks the notes; this one did not.
       */
      l.kind === "todo" ? `<span class="diary-date">${copy.letterNote}</span>` : ""}
      ${l.kind !== "todo" && l.status === "private" ? `<span class="diary-date">${copy.letterKept}</span>` : ""}
      ${l.kind !== "todo" && l.status === "waiting" ? `<span class="diary-date">${copy.letterWaiting}</span>` : ""}
      ${l.kind !== "todo" && l.status === "answered" ? `<span class="diary-date">${copy.letterAnswered}</span>` : ""}
      <p>${escapeHtml(l.body)}</p>
      ${l.replyText ? `<p class="reflection">${escapeHtml(l.replyText)}</p>` : ""}
    </div>`).join("\n")}
  </section>` : "";

  /**
   * The moments the user marked.
   *
   * They were missing from this export — the "export everything"
   * bundle had them, and the keepsake of a relationship had the
   * conversations and the memories and none of the moments.
   */
  const eventsHtml = (params.events ?? []).length > 0 ? `<section class="section">
    <h2>${copy.events}</h2>
    ${(params.events ?? []).map((e) => `<div class="diary-entry">
      <span class="diary-date">${formatDate(e.happenedAt, locale)}</span>
      <p><strong>${escapeHtml(e.title)}</strong></p>
      ${e.detail ? `<p class="reflection">${escapeHtml(e.detail)}</p>` : ""}
    </div>`).join("\n")}
  </section>` : "";

  const letterHtml = persona.farewellLetter ? `<section class="section">
    <h2>${copy.letter}</h2>
    <div class="farewell">
      <p class="farewell-text">${escapeHtml(persona.farewellLetter)}</p>
      ${persona.graduatedAt ? `<p class="farewell-date">${formatDate(persona.graduatedAt, locale)}</p>` : ""}
    </div>
  </section>` : "";

  return `<!DOCTYPE html>
<html lang="${locale === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(persona.name)} — ${copy.transcript}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans SC",sans-serif;background:#fafafa;color:#1a1a1a;line-height:1.6;max-width:800px;margin:0 auto;padding:24px 16px}
h1{font-size:1.5rem;font-weight:600;margin-bottom:4px}
h2{font-size:1.1rem;font-weight:600;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e5e5e5}
.section-note{color:#888;font-size:0.9rem;margin:-6px 0 12px}
.header{text-align:center;padding:32px 0;border-bottom:1px solid #e5e5e5;margin-bottom:24px}
.meta{color:#888;font-size:0.85rem;margin-top:4px}
.stats{display:flex;gap:24px;justify-content:center;margin-top:16px}
.stat{text-align:center}
.stat-val{font-size:1.5rem;font-weight:700;color:#7CB69D}
.stat-label{font-size:0.75rem;color:#888}
.section{margin-bottom:32px}
.day-group{margin-bottom:20px}
.day-label{text-align:center;font-size:0.75rem;color:#aaa;margin:16px 0 8px;position:relative}
.day-label::before,.day-label::after{content:"";position:absolute;top:50%;width:30%;height:1px;background:#e5e5e5}
.day-label::before{left:0}.day-label::after{right:0}
.msg{display:flex;flex-direction:column;margin-bottom:8px;max-width:75%}
.msg-user{align-items:flex-end;margin-left:auto}
.msg-ai{align-items:flex-start}
.bubble{padding:8px 14px;border-radius:16px;font-size:0.9rem;word-break:break-word;white-space:pre-wrap}
.bubble-user{background:#7CB69D;color:#fff;border-bottom-right-radius:4px}
.bubble-ai{background:#f0f0f0;color:#1a1a1a;border-bottom-left-radius:4px}
.badge{font-size:0.7rem;padding:1px 8px;border-radius:10px;margin-bottom:2px;display:inline-block}
.time{font-size:0.65rem;color:#bbb;margin-top:2px;padding:0 4px}
.memories{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.memory-card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:12px}
.mem-cat{font-size:0.7rem;color:#888}.mem-date{font-size:0.7rem;color:#aaa;margin-left:8px}
.mem-title{font-size:0.85rem;font-weight:500;margin-top:4px}
.mem-desc{font-size:0.75rem;color:#666;margin-top:2px}
.diary-entry{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:12px;margin-bottom:8px}
.diary-date{font-size:0.75rem;color:#7CB69D;font-weight:500}
.diary-entry p{font-size:0.85rem;margin-top:4px}
.reflection{color:#888;font-style:italic}
.farewell{background:#fff;border:1px solid #e5e5e5;border-left:3px solid #c8a27a;border-radius:12px;padding:16px}
.farewell-text{font-size:0.95rem;line-height:1.9;white-space:pre-wrap}
.farewell-date{font-size:0.75rem;color:#999;margin-top:10px;text-align:right}
.footer{text-align:center;color:#ccc;font-size:0.7rem;margin-top:40px;padding-top:16px;border-top:1px solid #e5e5e5}
@media print{body{max-width:100%;padding:12px}.bubble-user{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="header">
  <h1>${escapeHtml(persona.name)}</h1>
  <p class="meta">${escapeHtml(persona.relationshipDesc || "")} · ${dateRange}</p>
  <div class="stats">
    <div class="stat"><div class="stat-val">${messages.length}</div><div class="stat-label">${copy.messageCount}</div></div>
    <div class="stat"><div class="stat-val">${memories.length}</div><div class="stat-label">${copy.memoryCount}</div></div>
    <div class="stat"><div class="stat-val">${intimacy.score}</div><div class="stat-label">${escapeHtml(intimacyLevelLabel(intimacy.level, locale))}</div></div>
  </div>
</div>
${emotionSection}
${memoriesHtml}
${letterHtml}
${eventsHtml}
${lettersHtml}
<section class="section">
  <h2>${copy.transcript}</h2>
  ${messagesHtml}
</section>
${diaryHtml}
<div class="footer">${copy.exportedOn} ${new Date().toLocaleString(locale === "en" ? "en-US" : "zh-CN")} · Mirrai</div>
</body>
</html>`;
}

/**
 * "The manual" of a persona (C2.9)
 *
 * A printable page built from what the user confirmed and what was
 * measured. It is not a prompt and it is not written by a model: every
 * section is a list of facts, each with the line it came from.
 */
export interface ManualInput {
  persona: {
    name: string;
    relationshipDesc?: string | null;
    togetherFrom?: string | null;
    togetherTo?: string | null;
  };
  personaData?: {
    microRules?: unknown;
    stances?: unknown;
    people?: unknown;
    lexicon?: unknown;
    lifeEvents?: unknown;
  } | null;
  styleProfile?: {
    fingerprint?: unknown;
    triggers?: unknown;
    conflict?: unknown;
    routine?: unknown;
  } | null;
}

const MANUAL_COPY = {
  zh: {
    title: "{{name}} 的说明书",
    who: "是谁",
    voice: "说话的样子",
    meaning: "这些话的意思",
    triggers: "这些话之后通常会不高兴",
    repair: "怎么和好",
    likes: "喜欢和讨厌",
    people: "身边的人",
    routine: "作息",
    lexicon: "我们的词",
    footer: "这份文档是从你导入的记录里整理的。记录是过去的，人会变。它不是 {{name}} 本人写的，也不能代替去问 {{name}}。",
    when: "当我说「{{trigger}}」",
    means: "意思是：{{meaning}}",
    renders: "当时 TA 的反应：{{rendering}}",
    mention: "提到 {{n}} 次",
    relation: "关系：{{relation}}",
    evidence: "原话",
    episodes: "记到的冲突有 {{n}} 次",
    duration: "一般持续 {{median}} 分钟",
    repairBy: "{{them}} 次是 TA 先开口，{{me}} 次是我先开口",
    sleep: "一般 {{start}} 到 {{end}} 不在线",
    routineWindow: "{{title}}（{{start}}–{{end}}）",
    weekdays: ["日", "一", "二", "三", "四", "五", "六"],
    userActs: {
      ask: "在问一件事",
      acknowledge: "只应了一声",
      share: "在跟我分享",
      affection: "在表达亲近",
      tease: "在逗我",
      complain: "在抱怨、发火",
      logistics: "在商量事情",
      repair: "在道歉、和好",
      comfort: "在安慰我",
      advise: "在给我建议",
      other: "说了一句",
    },
  },
  en: {
    title: "The manual of {{name}}",
    who: "Who they are",
    voice: "How they speak",
    meaning: "What those words mean",
    triggers: "What usually comes after these",
    repair: "How you make up",
    likes: "Likes and dislikes",
    people: "People around them",
    routine: "Daily rhythm",
    lexicon: "Words of your own",
    footer: "This document is put together from the record you imported. The record is the past, and people change. It was not written by {{name}}, and it is no substitute for asking {{name}}.",
    when: "When I say “{{trigger}}”",
    means: "It means: {{meaning}}",
    renders: "What they did: {{rendering}}",
    mention: "mentioned {{n}} times",
    relation: "Relation: {{relation}}",
    evidence: "In the record",
    episodes: "{{n}} fights were counted",
    duration: "usually lasting {{median}} minutes",
    repairBy: "They reached out {{them}} times; I did {{me}} times",
    sleep: "Usually offline from {{start}} to {{end}}",
    routineWindow: "{{title}} ({{start}}–{{end}})",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    userActs: {
      ask: "asking something",
      acknowledge: "just acknowledging",
      share: "sharing something",
      affection: "being affectionate",
      tease: "teasing",
      complain: "complaining or angry",
      logistics: "sorting something out",
      repair: "apologising or making up",
      comfort: "comforting",
      advise: "giving advice",
      other: "saying something",
    },
  },
} as const;

function minutesText(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function generateManualHTML(
  input: ManualInput,
  locale: ExportLocale = "zh",
): string {
  const copy = MANUAL_COPY[locale];
  /**
   * The raw name (C2.9).
   *
   * It is escaped where it is printed, exactly once. Escaping it here
   * and then escaping the whole title again turned 「小A & 朋友」 into
   * 「小A &amp;amp; 朋友」.
   */
  const name = input.persona.name;
  const data = normalizePersonaData(
    (input.personaData ?? {}) as Record<string, unknown>,
    { name: input.persona.name, locale },
  );
  const style = input.styleProfile ?? {};
  const fingerprint = (style.fingerprint ?? null) as Parameters<typeof describeFingerprint>[0];
  const rules = normalizeMicroRules(data.microRules).filter((rule) => rule.verified);
  const stances = normalizeStances(data.stances).filter((stance) => stance.verified);
  const people = normalizePeople(data.people).filter((person) => person.verified);
  const lexicon = normalizeLexicon(data.lexicon).filter((entry) => entry.verified);
  const lifeEvents = normalizeLifeEvents(data.lifeEvents);
  const triggers = normalizeTriggers(style.triggers) ?? [];
  const conflict = normalizeConflictProfile(style.conflict);
  const routine = normalizeRoutine(style.routine);

  const quote = (snippet: string, at?: string) =>
    `<p class="quote">${copy.evidence}: “${escapeHtml(snippet)}”${
      at ? ` <span class="date">${escapeHtml(at.slice(0, 10))}</span>` : ""
    }</p>`;

  const section = (title: string, body: string[]) =>
    body.length > 0
      ? `<section><h2>${escapeHtml(title)}</h2>${body.join("")}</section>`
      : "";

  const who = [
    input.persona.relationshipDesc?.trim()
      ? `<p>${escapeHtml(input.persona.relationshipDesc.trim())}</p>`
      : "",
    input.persona.togetherFrom
      ? `<p class="date">${escapeHtml(input.persona.togetherFrom)}${
          input.persona.togetherTo ? ` — ${escapeHtml(input.persona.togetherTo)}` : ""
        }</p>`
      : "",
  ].filter(Boolean);

  const voice = describeFingerprint(fingerprint, locale).map(
    (line) => `<p>${escapeHtml(line.text)}</p>`,
  );

  const meaning = rules.flatMap((rule) => [
    `<div class="item"><p>${escapeHtml(
      copy.when.replace("{{trigger}}", rule.trigger.join(locale === "zh" ? "、" : ", ")),
    )}</p><p>${escapeHtml(copy.means.replace("{{meaning}}", rule.meaning))}</p><p>${escapeHtml(
      copy.renders.replace("{{rendering}}", rule.rendering),
    )}</p>${rule.evidence.map((evidence) => quote(evidence.snippet, evidence.at)).join("")}</div>`,
  ]);

  const userActs = copy.userActs as Record<string, string>;
  const triggerSection = triggers.map(
    (trigger) =>
      `<div class="item"><p>${escapeHtml(
        copy.when.replace("{{trigger}}", userActs[trigger.userAct] ?? trigger.userAct),
      )}</p>${trigger.examples.map((example) => quote(example.text, example.at)).join("")}</div>`,
  );

  const repair = conflict
    ? [
        `<p>${escapeHtml(copy.episodes.replace("{{n}}", String(conflict.episodes)))}，${escapeHtml(
          copy.duration.replace("{{median}}", String(conflict.durationMin.median)),
        )}。</p>`,
        `<p>${escapeHtml(
          copy.repairBy
            .replace("{{them}}", String(conflict.repairBy.them))
            .replace("{{me}}", String(conflict.repairBy.me)),
        )}</p>`,
        ...conflict.repairLines.map((line) => quote(line)),
      ]
    : [];

  const likes = stances.map(
    (stance) =>
      `<div class="item"><p>${escapeHtml(stance.statement)}</p>${stance.evidence
        .map((evidence) => quote(evidence.snippet, evidence.at))
        .join("")}</div>`,
  );

  const peopleSection = people.map(
    (person) =>
      `<div class="item"><p>${escapeHtml(person.name)} · ${escapeHtml(
        copy.relation.replace("{{relation}}", person.relation),
      )} · ${escapeHtml(copy.mention.replace("{{n}}", String(person.mentions)))}</p>${person.evidence
        .map((evidence) => quote(evidence.snippet, evidence.at))
        .join("")}</div>`,
  );

  const routineLines: string[] = [];
  if (routine?.sleep) {
    routineLines.push(
      `<p>${escapeHtml(
        copy.sleep
          .replace("{{start}}", minutesText(routine.sleep.startMin))
          .replace("{{end}}", minutesText(routine.sleep.endMin)),
      )}</p>`,
    );
  }
  for (const event of lifeEvents) {
    if (!event.verified || event.kind !== "routine" || !event.schedule) continue;
    const weekdays = event.schedule.weekdays
      .map((day) => copy.weekdays[day] ?? "")
      .join(locale === "zh" ? "" : ", ");
    routineLines.push(
      `<p>${escapeHtml(
        copy.routineWindow
          .replace("{{title}}", event.title)
          .replace("{{start}}", `${weekdays} ${minutesText(event.schedule.startHour * 60)}`)
          .replace("{{end}}", minutesText(event.schedule.endHour * 60)),
      )}</p>`,
    );
  }

  const lexiconSection = lexicon.map(
    (entry) =>
      `<div class="item"><p>${escapeHtml(entry.term)} —— ${escapeHtml(entry.gloss)}</p>${entry.evidence
        .slice(0, 2)
        .map((evidence) => quote(evidence.snippet, evidence.at))
        .join("")}</div>`,
  );

  const body = [
    section(copy.who, who),
    section(copy.voice, voice),
    section(copy.meaning, meaning),
    section(copy.triggers, triggerSection),
    section(copy.repair, repair),
    section(copy.likes, likes),
    section(copy.people, peopleSection),
    section(copy.routine, routineLines),
    section(copy.lexicon, lexiconSection),
  ].join("");

  return `<!DOCTYPE html>
<html lang="${locale === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(copy.title.replace("{{name}}", name))}</title>
<style>
  body { font-family: -apple-system, "Noto Sans CJK SC", sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.7; color: #222; }
  h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.05rem; margin-top: 1.75rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
  .item { margin: 0.75rem 0; }
  .quote { color: #555; font-size: 0.9rem; margin: 0.25rem 0; }
  .date { color: #888; font-size: 0.8rem; }
  footer { margin-top: 2.5rem; border-top: 1px solid #ddd; padding-top: 0.75rem; color: #666; font-size: 0.85rem; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${escapeHtml(copy.title.replace("{{name}}", name))}</h1>
${body}
<footer>${escapeHtml(copy.footer.replace("{{name}}", name))}</footer>
</body>
</html>`;
}


/**
 * The one-page summary for a counsellor or a doctor (C4.6).
 *
 * It is built to be printed and handed over. It carries the numbers the
 * user already has — mood check-ins, visits, after-chat answers,
 * relationship events, safety-event counts — and, only when the user
 * asks, high-frequency words from their own lines and the diary they
 * wrote. It never carries the persona's words or the conversation
 * itself, and it never calls a model.
 *
 * No external resource: the mood curve is inline SVG, so the file opens
 * on a machine with no network and prints without fetching anything.
 */
const COUNSELOR_COPY = {
  zh: {
    title: "给咨询师的一页摘要",
    range: "时间范围",
    moods: "心情打卡",
    moodCount: "打卡 {{n}} 次",
    noMoods: "这段时间没有打卡。",
    weeks: "每周来的次数",
    week: "{{start}} 那一周：{{visits}} 天，深夜 0–5 点来的 {{late}}/{{messages}} 条",
    noWeeks: "这段时间没有记录。",
    checkins: "聊完之后的回答",
    checkinBetter: "好一点",
    checkinSame: "差不多",
    checkinWorse: "更难受",
    checkinSkipped: "不想答",
    events: "关系事件",
    noEvents: "这段时间没有记下关系事件。",
    safety: "安全事件（只按类型计数）",
    noSafety: "没有记录。",
    themes: "我自己说过的高频词",
    journal: "我自己写的日记",
    footer: "这份摘要由 Mirrai 在本机生成，没有发送到任何地方。它不是诊断。",
    range30: "最近 30 天",
    range90: "最近 90 天",
    rangeAll: "全部",
  },
  en: {
    title: "One-page summary for a counsellor",
    range: "Time range",
    moods: "Mood check-ins",
    moodCount: "{{n}} check-ins",
    noMoods: "No check-ins in this period.",
    weeks: "Days you came, by week",
    week: "Week of {{start}}: {{visits}} days, {{late}}/{{messages}} late-night (0–5)",
    noWeeks: "Nothing recorded in this period.",
    checkins: "After-conversation answers",
    checkinBetter: "Better",
    checkinSame: "About the same",
    checkinWorse: "Worse",
    checkinSkipped: "Rather not say",
    events: "Relationship events",
    noEvents: "No relationship events in this period.",
    safety: "Safety events (counts only)",
    noSafety: "None recorded.",
    themes: "Words I used often",
    journal: "My own diary",
    footer: "This summary was generated by Mirrai on this machine and was not sent anywhere. It is not a diagnosis.",
    range30: "The last 30 days",
    range90: "The last 90 days",
    rangeAll: "All of it",
  },
} as const;

export interface CounselorWeek {
  start: string;
  visits: number;
  lateNight: number;
  /** The user's own messages in the week, the denominator of the share. */
  messages: number;
}

export interface CounselorSummaryInput {
  range: "30d" | "90d" | "all";
  from: Date | null;
  to: Date;
  moods: Array<{ date: string; mood: string }>;
  weeks: CounselorWeek[];
  checkins: Array<{ answer: string }>;
  events: Array<{ happenedAt: Date; title: string }>;
  safetyCounts: Record<string, number>;
  /** The conversation, only so the user's own lines can supply themes. */
  messages: Array<{ role: string; content: string; timestamp?: Date | null; kind?: string | null }>;
  includeThemes: boolean;
  includeJournal: boolean;
  journal: Array<{ entryDate: string; body: string }>;
}

const MOOD_SCORE: Record<string, number> = {
  happy: 5,
  warm: 4,
  playful: 4,
  nostalgic: 3,
  melancholy: 2,
  distant: 1,
};

function moodCurve(moods: Array<{ date: string; mood: string }>): string {
  if (moods.length === 0) return "";
  const points = moods.map((entry, index) => {
    const x = moods.length <= 1 ? 50 : (index / (moods.length - 1)) * 100;
    const score = MOOD_SCORE[entry.mood] ?? 3;
    const y = 34 - (score / 5) * 28;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg viewBox="0 0 100 36" width="100%" height="64" role="img" aria-label="mood">
  <polyline points="${points}" fill="none" stroke="#555" stroke-width="1.2" />
</svg>`;
}

export function generateCounselorSummaryHTML(
  input: CounselorSummaryInput,
  locale: ExportLocale = "zh",
): string {
  const copy = COUNSELOR_COPY[locale];
  const rangeLabel = input.range === "30d" ? copy.range30 : input.range === "90d" ? copy.range90 : copy.rangeAll;
  const check = (answer: string) =>
    input.checkins.filter((entry) => entry.answer === answer).length;
  const moodCount = input.moods.length;
  const moodSection = [
    `<p>${escapeHtml(copy.moodCount.replace("{{n}}", String(moodCount)))}</p>`,
    moodCurve(input.moods),
    moodCount === 0 ? `<p>${escapeHtml(copy.noMoods)}</p>` : "",
  ].join("");
  const weekRows = input.weeks.map((week) =>
    `<li>${escapeHtml(
      copy.week
        .replace("{{start}}", week.start)
        .replace("{{visits}}", String(week.visits))
        .replace("{{late}}", String(week.lateNight))
        .replace("{{messages}}", String(week.messages)),
    )}</li>`,
  );
  const eventRows = input.events.map((event) =>
    `<li>${escapeHtml(event.happenedAt.toISOString().slice(0, 10))} · ${escapeHtml(event.title)}</li>`,
  );
  const safetyRows = Object.entries(input.safetyCounts)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `<li>${escapeHtml(type)}: ${n}</li>`);
  const themes = input.includeThemes
    ? collectLexiconCandidates(
        input.messages
          .filter((row) => row.role === "user")
          .map((row) => ({
            role: "user",
            content: row.content,
            timestamp: row.timestamp ?? null,
            kind: row.kind ?? "text",
          })) as LexiconRow[],
      )
        .filter((candidate) => candidate.count >= 3)
        .slice(0, 12)
    : [];
  const journalRows = input.includeJournal
    ? input.journal.map((entry) =>
        `<div class="item"><p class="date">${escapeHtml(entry.entryDate)}</p><p>${escapeHtml(entry.body)}</p></div>`,
      )
    : [];

  const section = (title: string, body: string) =>
    body ? `<section><h2>${escapeHtml(title)}</h2>${body}</section>` : "";

  const body = [
    `<p>${escapeHtml(copy.range)}: ${escapeHtml(rangeLabel)}</p>`,
    section(copy.moods, moodSection),
    section(
      copy.weeks,
      weekRows.length > 0 ? `<ul>${weekRows.join("")}</ul>` : `<p>${escapeHtml(copy.noWeeks)}</p>`,
    ),
    section(
      copy.checkins,
      `<ul>
        <li>${escapeHtml(copy.checkinBetter)}: ${check("better")}</li>
        <li>${escapeHtml(copy.checkinSame)}: ${check("same")}</li>
        <li>${escapeHtml(copy.checkinWorse)}: ${check("worse")}</li>
        <li>${escapeHtml(copy.checkinSkipped)}: ${check("skipped")}</li>
      </ul>`,
    ),
    section(
      copy.events,
      eventRows.length > 0 ? `<ul>${eventRows.join("")}</ul>` : `<p>${escapeHtml(copy.noEvents)}</p>`,
    ),
    section(
      copy.safety,
      safetyRows.length > 0 ? `<ul>${safetyRows.join("")}</ul>` : `<p>${escapeHtml(copy.noSafety)}</p>`,
    ),
    themes.length > 0
      ? section(copy.themes, `<p>${themes.map((entry) => escapeHtml(entry.term)).join("、")}</p>`)
      : "",
    journalRows.length > 0 ? section(copy.journal, journalRows.join("")) : "",
  ].join("");

  return `<!DOCTYPE html>
<html lang="${locale === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(copy.title)}</title>
<style>
  body { font-family: -apple-system, "Noto Sans CJK SC", sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.7; color: #222; }
  h1 { font-size: 1.55rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.05rem; margin-top: 1.5rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
  ul { padding-left: 1.2rem; }
  .date { color: #888; font-size: 0.8rem; margin-bottom: 0; }
  footer { margin-top: 2.5rem; border-top: 1px solid #ddd; padding-top: 0.75rem; color: #666; font-size: 0.85rem; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${escapeHtml(copy.title)}</h1>
${body}
<footer>${escapeHtml(copy.footer)}</footer>
</body>
</html>`;
}
