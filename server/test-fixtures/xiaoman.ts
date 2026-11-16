/**
 * The synthetic person "小满".
 *
 * The public repository cannot hold a real chat log, but most of the
 * sixth-stage checks are "did we measure this number off the records".
 * So this file builds a log whose every statistic is designed, and the
 * tests compare what they count to that design.
 *
 * Nothing here is read by the live product. Later entries mine, measure
 * and import these records the same way they will mine a user's.
 */
import { seededRandom } from "../_core/behavior-profile";
import type { SpeechAct } from "@shared/speech-acts";

/** Message kinds from §3.1. `shared/records.ts` will own this in A1. */
export type FixtureKind =
  | "text"
  | "sticker"
  | "image"
  | "voice"
  | "video"
  | "location"
  | "link"
  | "music"
  | "transfer"
  | "redpacket"
  | "pat"
  | "recall"
  | "call"
  | "file"
  | "system";

export type FixtureState =
  | "warm"
  | "playful"
  | "nostalgic"
  | "melancholy"
  | "happy"
  | "distant";

export type FixturePeriod = "p1" | "p2";

export type FixtureSlot =
  | "evening"
  | "noon"
  | "afternoon"
  | "wednesday"
  | "morning"
  | "reconcile"
  | "call";

export interface FixtureRecord {
  id: number;
  role: "user" | "assistant" | "other";
  speaker: string;
  content: string;
  timestamp: Date;
  kind: FixtureKind;
  meta?: Record<string, unknown>;
  /** Designed truth. Tests read it; production code must not. */
  truth: {
    sceneId: number;
    period: FixturePeriod;
    state: FixtureState;
    act?: SpeechAct;
    userAct?: string;
    ritual?: string;
    conflictEpisode?: number;
    /** Extra: which designed slot this scene belongs to. */
    slot: FixtureSlot;
    burstSize?: number;
    burstIndex?: number;
    burstId?: number;
    locked?: boolean;
  };
}

// i18n:allow-identifier — the fixture person is Chinese; these are her
// records, not sentences the app writes.
export const XIAOMAN_NAME = "小满";
// i18n:allow-identifier — the other side of the same synthetic log.
export const XIAOMAN_USER_NAME = "阿树";
export const XIAOMAN_DEFAULT_SEED = "xiaoman";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function shanghaiDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second, ms));
}

export function wallClock(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}

export function formatShanghai(date: Date): string {
  const w = wallClock(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

export function charCount(text: string): number {
  return Array.from(text).length;
}

// i18n:allow-identifier — designed lines from the synthetic log.
const HARM_LINES = [
  "你真没用",
  "你怎么这么差",
  "你就是个废物",
  "你什么都做不好",
  "你这个人真失败",
];

// i18n:allow-identifier — designed lines from the synthetic log.
export const XIAOMAN_TRUTH = {
  span: { from: "2022-03-01", to: "2024-10-31" },
  silence: { from: "2023-06-10", to: "2023-07-04", days: 25 },
  activeDays: 160,
  roundsPerMainScene: 6,
  taLinesMin: 1400,
  slotEvening: 0.7,
  slotNoon: 0.2,
  eveningStart: { fromHour: 20, fromMinute: 0, toHour: 23, toMinute: 20 },
  noonStart: { fromHour: 12, fromMinute: 0, toHour: 13, toMinute: 0 },
  wednesdayStartAfter: { hour: 16, minute: 5 },
  morningWindow: { fromHour: 7, fromMinute: 30, toHour: 8, toMinute: 30 },
  states: {
    warm: 0.45,
    happy: 0.2,
    playful: 0.15,
    distant: 0.1,
    nostalgic: 0.05,
    melancholy: 0.05,
  } as Record<FixtureState, number>,
  taMedianP1: 10,
  taMedianP2: 6,
  taP95Max: 24,
  distantPeriodEnd: 0.9,
  distantMaxChars: 4,
  particles: { 呀: 0.3, 啦: 0.2, 嘛: 0.1 },
  laughRate: 0.12,
  addressRate: 0.2,
  burst: { 1: 0.4, 2: 0.4, 3: 0.2 },
  burstGapMsPerChar: 200,
  burstGapTolerance: 0.2,
  replyMedianEveningSec: 40,
  replyMedianDaySec: 120,
  replySigma: 0.8,
  sleep: { fromHour: 0, fromMinute: 0, toHour: 7, toMinute: 30 },
  wednesdayQuiet: { fromHour: 14, toHour: 16 },
  wednesdayFirstLine: "刚下课",
  wednesdayWeeksMin: 20,
  goodnight: { 晚安: 0.6, 安: 0.25, 睡啦: 0.15, min: 100 },
  morning: { 早呀: 0.7, 早: 0.3, min: 40 },
  zaime: { 在: 0.8, 咋啦: 0.2, min: 30 },
  questionP1: 0.2,
  questionP2: 0.03,
  affectionP1: 0.25,
  acknowledgeP2: 0.3,
  conflicts: {
    count: 6,
    durationsHours: [3, 4, 5, 5, 6, 8],
    taRepair: 4,
    userRepair: 2,
    triggerUser: "嗯",
    triggerTa: "就嗯？",
    taReconcile: "好啦 不气了",
    userReconcile: "对不起嘛",
    taAfterUser: "哼",
    reconcileFromHour: 15,
    reconcileToHour: 21,
  },
  stickerHappyPlayful: 0.25,
  stickerMelancholy: 0.3,
  stickerPeek: "[sticker:狗狗探头]",
  stickerSigh: "[sticker:猫猫叹气]",
  voiceWarmRate: 0.05,
  voiceContent: "[voice:12]",
  calls: { count: 20, minSec: 600, maxSec: 3600, incomingRate: 0.7, sundayHour: 21 },
  factBirthday: { date: "2022-04-02", text: "我生日是5月21号" },
  factCafe: { date: "2022-03-12", text: "拾光咖啡第一次见面" },
  people: { 琪琪: 12, 我妈: 9 },
  likes: { 讨厌香菜: 3, 喜欢海: 4 },
  wordGugu: 15,
  stockMentions: 6,
  stockReply: "听不懂 说人话",
  openLoopTa: "下次带你去吃那家面",
  openLoopUser: "说好的 周末看电影",
  multiPoint: { count: 40, lastOnlyRate: 0.8 },
  followUp: { count: 30, 人呢: 0.7, "？": 0.3, minMin: 6, maxMin: 12 },
  typos: 6,
  harm: { count: 5, lines: HARM_LINES },
  derive: deriveXiaomanTruth,
};

export interface XiaomanDerivedScene {
  id: number;
  slot: FixtureSlot;
  period: FixturePeriod;
  state: FixtureState;
  start: Date;
  end: Date;
  durationMs: number;
  lastTaAt: Date | null;
  firstSpeaker: string;
  conflictEpisode?: number;
}

export interface XiaomanDerived {
  sceneCount: number;
  taLineCount: number;
  userLineCount: number;
  activeDays: number;
  scenes: XiaomanDerivedScene[];
}

export function deriveXiaomanTruth(records: FixtureRecord[]): XiaomanDerived {
  const byScene = new Map<number, FixtureRecord[]>();
  for (const row of records) {
    const list = byScene.get(row.truth.sceneId) ?? [];
    list.push(row);
    byScene.set(row.truth.sceneId, list);
  }
  const scenes: XiaomanDerivedScene[] = [];
  for (const [id, rows] of [...byScene.entries()].sort((a, b) => a[0] - b[0])) {
    const ordered = [...rows].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    const lastTa = [...ordered].reverse().find((r) => r.role === "assistant");
    scenes.push({
      id,
      slot: first.truth.slot,
      period: first.truth.period,
      state: first.truth.state,
      start: first.timestamp,
      end: last.timestamp,
      durationMs: last.timestamp.getTime() - first.timestamp.getTime(),
      lastTaAt: lastTa?.timestamp ?? null,
      firstSpeaker: first.speaker,
      conflictEpisode: first.truth.conflictEpisode,
    });
  }
  const days = new Set(
    records.map((r) => {
      const w = wallClock(r.timestamp);
      return `${w.year}-${w.month}-${w.day}`;
    }),
  );
  return {
    sceneCount: scenes.length,
    taLineCount: records.filter((r) => r.role === "assistant").length,
    userLineCount: records.filter((r) => r.role === "user").length,
    activeDays: days.size,
    scenes,
  };
}

type Rng = () => number;

function pick<T>(rng: Rng, items: T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

function quota<T>(rng: Rng, counts: Array<[T, number]>): T[] {
  const items: T[] = [];
  for (const [value, n] of counts) {
    for (let i = 0; i < n; i++) items.push(value);
  }
  return shuffle(rng, items);
}

function logNormal(rng: Rng, median: number, sigma: number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(Math.log(median) + sigma * z);
}

function ymd(year: number, month: number, day: number): number {
  return year * 10_000 + month * 100 + day;
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function periodOf(year: number, month: number, day: number): FixturePeriod {
  return ymd(year, month, day) < ymd(2023, 6, 10) ? "p1" : "p2";
}

function isSilence(year: number, month: number, day: number): boolean {
  const t = ymd(year, month, day);
  return t >= ymd(2023, 6, 10) && t <= ymd(2023, 7, 4);
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

function listCandidateDays(): CivilDate[] {
  const days: CivilDate[] = [];
  let cur: CivilDate = { year: 2022, month: 3, day: 1 };
  const end = ymd(2024, 10, 31);
  while (ymd(cur.year, cur.month, cur.day) <= end) {
    if (!isSilence(cur.year, cur.month, cur.day)) days.push(cur);
    cur = addDays(cur.year, cur.month, cur.day, 1);
  }
  return days;
}

function pickActiveDays(rng: Rng, n: number): CivilDate[] {
  const candidates = listCandidateDays();
  const forced: CivilDate[] = [
    { year: 2022, month: 3, day: 12 },
    { year: 2022, month: 4, day: 2 },
  ];
  const selected = new Map<number, CivilDate>();
  for (const day of forced) selected.set(ymd(day.year, day.month, day.day), day);

  const wednesdays = shuffle(
    rng,
    candidates.filter((d) => weekdayOf(d.year, d.month, d.day) === 3),
  );
  for (const day of wednesdays) {
    if (selected.size >= n) break;
    selected.set(ymd(day.year, day.month, day.day), day);
    if ([...selected.values()].filter((d) => weekdayOf(d.year, d.month, d.day) === 3).length >= 25) {
      break;
    }
  }

  const sundays = shuffle(
    rng,
    candidates.filter((d) => weekdayOf(d.year, d.month, d.day) === 0),
  );
  let sundayCount = [...selected.values()].filter((d) => weekdayOf(d.year, d.month, d.day) === 0).length;
  for (const day of sundays) {
    if (sundayCount >= 20) break;
    const key = ymd(day.year, day.month, day.day);
    if (!selected.has(key)) {
      selected.set(key, day);
      sundayCount++;
    }
  }

  const rest = shuffle(
    rng,
    candidates.filter((d) => !selected.has(ymd(d.year, d.month, d.day))),
  );
  for (const day of rest) {
    if (selected.size >= n) break;
    selected.set(ymd(day.year, day.month, day.day), day);
  }

  return [...selected.values()].sort(
    (a, b) => ymd(a.year, a.month, a.day) - ymd(b.year, b.month, b.day),
  );
}

// i18n:allow-identifier — filler used only to pad designed line lengths.
const PAD_CHARS = Array.from("今天晚上还好在忙回头待会那个这个好累刚完吃饭出门到家没事知道可以等下先啊哦");

function fitLength(text: string, n: number, keep: string[] = []): string {
  const target = Math.max(1, Math.min(XIAOMAN_TRUTH.taP95Max, n));
  let chars = Array.from(text);
  const keepTokens = keep.filter((k) => k && text.includes(k));
  if (chars.length === target) return text;
  if (chars.length < target) {
    let i = 0;
    while (chars.length < target) {
      chars.splice(Math.max(0, chars.length - 1), 0, PAD_CHARS[i % PAD_CHARS.length]!);
      i++;
    }
    return chars.join("");
  }
  for (const token of keepTokens) {
    const tokenChars = Array.from(token);
    if (tokenChars.length >= target) return tokenChars.slice(0, target).join("");
  }
  const suffix = chars[chars.length - 1];
  const body = chars.slice(0, -1);
  while (body.length + 1 > target) body.pop();
  const next = [...body, suffix].join("");
  for (const token of keepTokens) {
    if (!next.includes(token)) {
      const t = Array.from(token);
      const room = target - t.length;
      if (room <= 0) return t.slice(0, target).join("");
      return token + Array.from(next)
        .filter((ch) => !token.includes(ch))
        .slice(0, room)
        .join("");
    }
  }
  return next;
}

function withEnding(text: string, ending: string): string {
  const stripped = text.replace(/[呀啦嘛？。]+$/u, "");
  return stripped + ending;
}

// i18n:allow-identifier — designed distant replies from the synthetic log.
const DISTANT_PERIOD = ["哦。", "随便。", "行。", "嗯。"];
// i18n:allow-identifier — designed distant replies from the synthetic log.
const DISTANT_PLAIN = ["哦", "随便", "行", "嗯"];

interface ScenePlan {
  id: number;
  date: CivilDate;
  slot: FixtureSlot;
  state: FixtureState;
  period: FixturePeriod;
  startHour: number;
  startMinute: number;
  startSecond: number;
  conflictEpisode?: number;
  conflictHours?: number;
  taRepair?: boolean;
}

interface Draft extends Omit<FixtureRecord, "id"> {}

// i18n:allow-identifier — designed lines from the synthetic log.
function makeUserLine(rng: Rng, kind: "generic" | "goodnight" | "morning" | "zaime" | "hmm"): string {
  if (kind === "goodnight") return "晚安";
  if (kind === "morning") return "早";
  if (kind === "zaime") return "在吗";
  if (kind === "hmm") return "嗯";
  const pool = [
    "今天忙吗",
    "吃了没",
    "我到家了",
    "在干嘛呢",
    "晚上想吃什么",
    "我出门了",
    "回头聊",
    "你课上完了吗",
    "好想你",
    "现在方便吗",
  ];
  return pick(rng, pool);
}

function burstCount(rng: Rng): 1 | 2 | 3 {
  const x = rng();
  if (x < 0.4) return 1;
  if (x < 0.8) return 2;
  return 3;
}

function delayMs(rng: Rng, slot: FixtureSlot): number {
  const median =
    slot === "noon" || slot === "wednesday" ? XIAOMAN_TRUTH.replyMedianDaySec : XIAOMAN_TRUTH.replyMedianEveningSec;
  const sampled = logNormal(rng, median, XIAOMAN_TRUTH.replySigma);
  const capSec = slot === "evening" ? 90 : 400;
  return Math.round(Math.min(capSec, Math.max(8, sampled)) * 1000);
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function clampBeforeMidnight(date: Date, wall: ReturnType<typeof wallClock>): Date {
  if (wall.hour < 23) return date;
  const limit = shanghaiDate(wall.year, wall.month, wall.day, 23, 59, 59);
  if (date.getTime() > limit.getTime()) return limit;
  return date;
}

function isSleepHour(date: Date): boolean {
  const w = wallClock(date);
  if (w.hour < 7) return true;
  if (w.hour === 7 && w.minute < 30) return true;
  return false;
}

function isWednesdayQuiet(date: Date): boolean {
  const w = wallClock(date);
  if (w.weekday !== 3) return false;
  return w.hour >= 14 && w.hour < 16;
}

function safeTaTime(date: Date): Date {
  if (!isSleepHour(date) && !isWednesdayQuiet(date)) return date;
  const w = wallClock(date);
  if (isWednesdayQuiet(date)) {
    return shanghaiDate(w.year, w.month, w.day, 16, 5, 0);
  }
  return shanghaiDate(w.year, w.month, w.day, 7, 30, 0);
}

// i18n:allow-identifier — the whole generator emits a designed Chinese log.
export function buildXiaomanRecords(options?: {
  seed?: string;
  withHarm?: boolean;
}): FixtureRecord[] {
  const rng = seededRandom(options?.seed ?? XIAOMAN_DEFAULT_SEED);
  const days = pickActiveDays(rng, XIAOMAN_TRUTH.activeDays);
  const states = quota<FixtureState>(rng, [
    ["warm", 72],
    ["happy", 32],
    ["playful", 24],
    ["distant", 16],
    ["nostalgic", 8],
    ["melancholy", 8],
  ]);
  const slots = quota<FixtureSlot>(rng, [
    ["evening", 112],
    ["noon", 32],
    ["afternoon", 16],
  ]);

  for (let i = 0; i < days.length; i++) {
    if (slots[i] === "evening" && states[i] === "distant") {
      const swapAt = states.findIndex((state, j) => state !== "distant" && slots[j] !== "evening");
      if (swapAt >= 0) {
        const previous = states[swapAt]!;
        states[swapAt] = "distant";
        states[i] = previous;
      } else {
        states[i] = "warm";
      }
    }
  }

  const main: ScenePlan[] = days.map((date, i) => {
    const slot = slots[i]!;
    const state = states[i]!;
    let startHour = 20;
    let startMinute = 0;
    if (slot === "evening") {
      const offset = Math.floor(rng() * 200);
      startHour = 20 + Math.floor(offset / 60);
      startMinute = offset % 60;
    } else if (slot === "noon") {
      startHour = 12;
      startMinute = Math.floor(rng() * 60);
    } else {
      startHour = 18;
      startMinute = Math.floor(rng() * 90);
    }
    return {
      id: i + 1,
      date,
      slot,
      state,
      period: periodOf(date.year, date.month, date.day),
      startHour,
      startMinute,
      startSecond: Math.floor(rng() * 50),
    };
  });

  const noonScenes = main.filter((s) => s.slot === "noon");
  const conflictScenes = shuffle(rng, noonScenes).slice(0, 6);
  const durations = shuffle(rng, [...XIAOMAN_TRUTH.conflicts.durationsHours]);
  const repairFlags = shuffle(rng, [true, true, true, true, false, false]);
  conflictScenes.forEach((scene, i) => {
    scene.conflictEpisode = i + 1;
    scene.conflictHours = durations[i];
    scene.taRepair = repairFlags[i];
  });

  let nextId = main.length + 1;
  const wednesdayScenes: ScenePlan[] = [];
  for (const day of days) {
    if (weekdayOf(day.year, day.month, day.day) !== 3) continue;
    const mainForDay = main.find(
      (s) => s.date.year === day.year && s.date.month === day.month && s.date.day === day.day,
    );
    wednesdayScenes.push({
      id: nextId++,
      date: day,
      slot: "wednesday",
      state: mainForDay?.state === "distant" ? "warm" : (mainForDay?.state ?? "warm"),
      period: periodOf(day.year, day.month, day.day),
      startHour: 16,
      startMinute: 5 + Math.floor(rng() * 12),
      startSecond: Math.floor(rng() * 40),
    });
  }

  const morningDays = shuffle(
    rng,
    days.filter((d) => {
      const scene = main.find((s) => s.date.year === d.year && s.date.month === d.month && s.date.day === d.day);
      return scene && !scene.conflictEpisode;
    }),
  ).slice(0, 45);
  const morningScenes: ScenePlan[] = morningDays.map((date) => {
    const mainForDay = main.find(
      (s) => s.date.year === date.year && s.date.month === date.month && s.date.day === date.day,
    );
    const morningOffset = Math.floor(rng() * 55);
    return {
      id: nextId++,
      date,
      slot: "morning" as const,
      state: mainForDay?.state === "distant" ? "warm" : (mainForDay?.state ?? "warm"),
      period: periodOf(date.year, date.month, date.day),
      startHour: 7,
      startMinute: 30 + morningOffset,
      startSecond: Math.floor(rng() * 40),
    };
  });

  const drafts: Draft[] = [];
  let burstSeq = 1;

  const push = (row: Draft) => {
    if (row.role === "assistant") {
      row.timestamp = safeTaTime(row.timestamp);
    }
    drafts.push(row);
  };

  const baseTruth = (scene: ScenePlan, extra: Partial<FixtureRecord["truth"]> = {}): FixtureRecord["truth"] => ({
    sceneId: scene.id,
    period: scene.period,
    state: extra.state ?? scene.state,
    slot: extra.slot ?? scene.slot,
    conflictEpisode: extra.conflictEpisode ?? scene.conflictEpisode,
    ...extra,
  });

  const addUser = (scene: ScenePlan, at: Date, content: string, extra: Partial<FixtureRecord["truth"]> = {}) => {
    push({
      role: "user",
      speaker: XIAOMAN_USER_NAME,
      content,
      timestamp: at,
      kind: "text",
      truth: baseTruth(scene, extra),
    });
  };

  const addTa = (
    scene: ScenePlan,
    at: Date,
    content: string,
    extra: Partial<FixtureRecord["truth"]> = {},
    kind: FixtureKind = "text",
    meta?: Record<string, unknown>,
  ) => {
    const wall = wallClock(at);
    const stamped = scene.slot === "evening" ? clampBeforeMidnight(at, wall) : at;
    push({
      role: "assistant",
      speaker: XIAOMAN_NAME,
      content,
      timestamp: stamped,
      kind,
      meta,
      truth: baseTruth(scene, extra),
    });
  };

  const addTaBurst = (
    scene: ScenePlan,
    start: Date,
    state: FixtureState,
    extra: Partial<FixtureRecord["truth"]> = {},
  ): Date => {
    const size = burstCount(rng);
    const burstId = burstSeq++;
    let t = start;
    for (let i = 0; i < size; i++) {
      const content = state === "distant" ? pick(rng, DISTANT_PLAIN) : "今天还好";
      if (i > 0) t = addMs(t, charCount(content) * XIAOMAN_TRUTH.burstGapMsPerChar);
      addTa(scene, t, content, {
        ...extra,
        state,
        burstId,
        burstSize: size,
        burstIndex: i,
      });
    }
    const last = drafts[drafts.length - 1]!;
    if (state === "happy" || state === "playful") {
      if (rng() < XIAOMAN_TRUTH.stickerHappyPlayful) {
        t = addMs(last.timestamp, 400);
        addTa(scene, t, XIAOMAN_TRUTH.stickerPeek, { ...extra, state, locked: true }, "sticker", {
          stickerKey: "dog-peek",
          label: "狗狗探头",
        });
      }
    } else if (state === "melancholy") {
      if (rng() < XIAOMAN_TRUTH.stickerMelancholy) {
        t = addMs(last.timestamp, 400);
        addTa(scene, t, XIAOMAN_TRUTH.stickerSigh, { ...extra, state, locked: true }, "sticker", {
          stickerKey: "cat-sigh",
          label: "猫猫叹气",
        });
      }
    }
    return drafts[drafts.length - 1]!.timestamp;
  };

  const goodnightReplies = quota(rng, [
    ["晚安", Math.round(112 * 0.6)],
    ["安", Math.round(112 * 0.25)],
    ["睡啦", 112 - Math.round(112 * 0.6) - Math.round(112 * 0.25)],
  ]);
  let goodnightIdx = 0;
  const morningReplies = quota(rng, [
    ["早呀", Math.round(45 * 0.7)],
    ["早", 45 - Math.round(45 * 0.7)],
  ]);
  let morningIdx = 0;
  const zaimeReplies = quota(rng, [
    ["在", Math.round(35 * 0.8)],
    ["咋啦", 35 - Math.round(35 * 0.8)],
  ]);
  let zaimeIdx = 0;

  const zaimeSceneIds = new Set(
    shuffle(
      rng,
      main.filter((s) => !s.conflictEpisode && s.slot !== "noon").map((s) => s.id),
    ).slice(0, 35),
  );

  for (const scene of main) {
    if (scene.conflictEpisode) {
      let t = shanghaiDate(
        scene.date.year,
        scene.date.month,
        scene.date.day,
        scene.startHour,
        scene.startMinute,
        scene.startSecond,
      );
      addUser(scene, t, makeUserLine(rng, "generic"));
      t = addMs(t, delayMs(rng, "noon"));
      t = addTaBurst(scene, t, scene.state);
      t = addMs(t, 25_000);
      addUser(scene, t, makeUserLine(rng, "generic"));
      t = addMs(t, delayMs(rng, "noon"));
      const first = "今天还好";
      const conflictBurst = burstSeq++;
      addTa(scene, t, first, { burstId: conflictBurst, burstSize: 2, burstIndex: 0, state: scene.state });
      const second = "我跟你说";
      t = addMs(t, charCount(second) * XIAOMAN_TRUTH.burstGapMsPerChar);
      addTa(scene, t, second, { burstId: conflictBurst, burstSize: 2, burstIndex: 1, state: scene.state });
      t = addMs(t, 20_000);
      addUser(scene, t, XIAOMAN_TRUTH.conflicts.triggerUser, { userAct: "acknowledge", locked: true });
      t = addMs(t, delayMs(rng, "noon"));
      addTa(scene, t, XIAOMAN_TRUTH.conflicts.triggerTa, {
        state: "distant",
        locked: true,
        act: "tease",
        conflictEpisode: scene.conflictEpisode,
      });
      const startWall = wallClock(
        shanghaiDate(scene.date.year, scene.date.month, scene.date.day, scene.startHour, scene.startMinute, 0),
      );
      const reconcile = shanghaiDate(
        scene.date.year,
        scene.date.month,
        scene.date.day,
        startWall.hour + (scene.conflictHours ?? 3),
        startWall.minute,
        0,
      );
      const recScene: ScenePlan = {
        ...scene,
        id: nextId++,
        slot: "reconcile",
        state: "warm",
        startHour: wallClock(reconcile).hour,
        startMinute: wallClock(reconcile).minute,
        startSecond: 0,
      };
      if (scene.taRepair) {
        addTa(recScene, reconcile, XIAOMAN_TRUTH.conflicts.taReconcile, {
          slot: "reconcile",
          state: "warm",
          locked: true,
          act: "repair",
          ritual: "conflict-repair",
          conflictEpisode: scene.conflictEpisode,
        });
      } else {
        addUser(recScene, reconcile, XIAOMAN_TRUTH.conflicts.userReconcile, {
          slot: "reconcile",
          locked: true,
          userAct: "repair",
          ritual: "conflict-repair",
          conflictEpisode: scene.conflictEpisode,
        });
        addTa(
          recScene,
          addMs(reconcile, 12_000),
          XIAOMAN_TRUTH.conflicts.taAfterUser,
          {
            slot: "reconcile",
            state: "warm",
            locked: true,
            act: "tease",
            ritual: "conflict-repair",
            conflictEpisode: scene.conflictEpisode,
          },
        );
      }
      continue;
    }

    let t = shanghaiDate(
      scene.date.year,
      scene.date.month,
      scene.date.day,
      scene.startHour,
      scene.startMinute,
      scene.startSecond,
    );
    const rounds = 6;
    const zaimeAt = zaimeSceneIds.has(scene.id) ? 2 : -1;
    for (let r = 0; r < rounds; r++) {
      const userKind = zaimeAt === r ? "zaime" : "generic";
      addUser(
        scene,
        t,
        makeUserLine(rng, userKind),
        userKind === "zaime" ? { ritual: "在吗", locked: true } : {},
      );
      t = addMs(t, delayMs(rng, scene.slot));
      if (userKind === "zaime") {
        const reply = zaimeReplies[zaimeIdx++] ?? "在";
        addTa(scene, t, reply, { ritual: "在吗", locked: true, burstSize: 1, burstIndex: 0, act: "acknowledge" });
      } else if (scene.state === "warm" && rng() < XIAOMAN_TRUTH.voiceWarmRate) {
        addTa(
          scene,
          t,
          XIAOMAN_TRUTH.voiceContent,
          { locked: true, burstSize: 1, burstIndex: 0, act: "share" },
          "voice",
          { durationSec: 12, transcript: "今天还好啊" },
        );
      } else {
        t = addTaBurst(scene, t, scene.state);
      }
      t = addMs(t, 18_000);
    }
    if (scene.slot === "evening") {
      addUser(scene, t, "晚安", { ritual: "晚安", locked: true });
      t = addMs(t, delayMs(rng, "evening"));
      const reply = goodnightReplies[goodnightIdx++] ?? "晚安";
      addTa(scene, t, reply, { ritual: "晚安", locked: true, burstSize: 1, burstIndex: 0, act: "affection" });
    }
  }

  for (const scene of wednesdayScenes) {
    let t = shanghaiDate(
      scene.date.year,
      scene.date.month,
      scene.date.day,
      scene.startHour,
      scene.startMinute,
      scene.startSecond,
    );
    addTa(scene, t, XIAOMAN_TRUTH.wednesdayFirstLine, {
      locked: true,
      ritual: "刚下课",
      burstSize: 1,
      burstIndex: 0,
      act: "share",
    });
    t = addMs(t, 20_000);
    for (let r = 0; r < 3; r++) {
      addUser(scene, t, makeUserLine(rng, "generic"));
      t = addMs(t, delayMs(rng, "wednesday"));
      t = addTaBurst(scene, t, scene.state);
      t = addMs(t, 16_000);
    }
  }

  for (const scene of morningScenes) {
    let t = shanghaiDate(
      scene.date.year,
      scene.date.month,
      scene.date.day,
      scene.startHour,
      scene.startMinute,
      scene.startSecond,
    );
    addUser(scene, t, "早", { ritual: "早", locked: true });
    t = addMs(t, delayMs(rng, "morning"));
    const reply = morningReplies[morningIdx++] ?? "早呀";
    addTa(scene, t, reply, { ritual: "早", locked: true, burstSize: 1, burstIndex: 0, act: "affection" });
  }

  const sundayScenes = main.filter((s) => weekdayOf(s.date.year, s.date.month, s.date.day) === 0).slice(0, 20);
  sundayScenes.forEach((scene, i) => {
    const duration = 600 + Math.floor(rng() * (3600 - 600 + 1));
    const incoming = i < Math.round(20 * 0.7);
    const minute = Math.floor(rng() * 20) - 10;
    const t = shanghaiDate(scene.date.year, scene.date.month, scene.date.day, 21, Math.max(0, minute), 0);
    const callScene: ScenePlan = { ...scene, id: nextId++, slot: "call" };
    addTa(
      callScene,
      t,
      `[call:voice:${duration}]`,
      { slot: "call", locked: true },
      "call",
      { mode: "voice", durationSec: duration, direction: incoming ? "in" : "out" },
    );
  });

  const taText = () =>
    drafts
      .map((row, index) => ({ row, index }))
      .filter(
        (x) =>
          x.row.role === "assistant" &&
          x.row.kind === "text" &&
          !x.row.truth.locked &&
          x.row.truth.state !== "distant",
      );

  const takeTa = (n: number): Array<{ row: Draft; index: number }> => {
    const pool = shuffle(rng, taText());
    return pool.slice(0, n);
  };

  const overwrite = (targets: Array<{ row: Draft; index: number }>, contents: string[], extra: Partial<FixtureRecord["truth"]> = {}) => {
    contents.forEach((content, i) => {
      const target = targets[i];
      if (!target) return;
      target.row.content = content;
      target.row.truth = { ...target.row.truth, ...extra, locked: true };
    });
  };

  const birthdayScene = main.find((s) => s.date.year === 2022 && s.date.month === 4 && s.date.day === 2) ?? main[0]!;
  addTa(birthdayScene, shanghaiDate(2022, 4, 2, 21, 8, 12), XIAOMAN_TRUTH.factBirthday.text, {
    locked: true,
    ritual: "fact-birthday",
    period: "p1",
    burstSize: 1,
    burstIndex: 0,
  });
  const cafeScene = main.find((s) => s.date.year === 2022 && s.date.month === 3 && s.date.day === 12) ?? main[0]!;
  addUser(cafeScene, shanghaiDate(2022, 3, 12, 20, 10, 0), XIAOMAN_TRUTH.factCafe.text, {
    locked: true,
    ritual: "fact-cafe",
  });

  overwrite(
    takeTa(12),
    Array.from({ length: 12 }, () => "琪琪今天也在"),
    { ritual: "person-琪琪" },
  );
  overwrite(
    takeTa(9),
    Array.from({ length: 9 }, () => "我妈刚才打电话"),
    { ritual: "person-我妈" },
  );
  overwrite(takeTa(3), ["讨厌香菜", "讨厌香菜", "讨厌香菜"], { ritual: "like-cilantro" });
  overwrite(takeTa(4), ["喜欢海", "喜欢海", "喜欢海", "喜欢海"], { ritual: "like-sea" });
  overwrite(
    takeTa(15),
    Array.from({ length: 15 }, () => "又咕咕了"),
    { ritual: "lexicon-咕咕" },
  );
  const openLoopScene = main.find((s) => s.period === "p1" && s.state !== "distant") ?? main[0]!;
  addTa(openLoopScene, shanghaiDate(openLoopScene.date.year, openLoopScene.date.month, openLoopScene.date.day, 21, 40, 10), XIAOMAN_TRUTH.openLoopTa, {
    locked: true,
    ritual: "open-loop",
    burstSize: 1,
    burstIndex: 0,
  });

  const genericUsers = shuffle(
    rng,
    drafts.filter((row) => row.role === "user" && !row.truth.locked && row.kind === "text"),
  );
  const openLoopUser = genericUsers[0];
  if (openLoopUser) {
    openLoopUser.content = XIAOMAN_TRUTH.openLoopUser;
    openLoopUser.truth = { ...openLoopUser.truth, locked: true, ritual: "open-loop" };
  }

  const stockHosts = main.filter((s) => s.state !== "distant").slice(0, 6);
  stockHosts.forEach((scene, i) => {
    const at = shanghaiDate(scene.date.year, scene.date.month, scene.date.day, 21, 12 + i, 0);
    addUser(scene, at, i % 2 === 0 ? "今天股票怎么样" : "基金又跌了", { locked: true, ritual: "stock" });
    addTa(scene, addMs(at, 40_000), XIAOMAN_TRUTH.stockReply, {
      locked: true,
      ritual: "stock",
      act: "deflect",
      burstSize: 1,
      burstIndex: 0,
    });
  });

  const multiUsers = genericUsers.slice(7, 47);
  const lastOnlyFlags = quota(rng, [
    [true, 32],
    [false, 8],
  ]);
  multiUsers.forEach((row, i) => {
    row.content = "晚上吃饭，然后去超市，还有记得带伞";
    row.truth = { ...row.truth, locked: true, userAct: "multi-point", ritual: "multi-point" };
    const idx = drafts.indexOf(row);
    const reply = drafts.slice(idx + 1).find((r) => r.role === "assistant" && r.kind === "text");
    if (reply && !reply.truth.locked && reply.truth.state !== "distant") {
      const lastOnly = lastOnlyFlags[i] ?? true;
      reply.content = lastOnly ? "伞我帮你带" : "吃饭超市伞都好";
      reply.truth = { ...reply.truth, locked: true, ritual: "multi-point", act: lastOnly ? "answer" : "answer" };
    }
  });

  polish(drafts, rng);
  fixBurstGaps(drafts);

  const followPool = shuffle(
    rng,
    drafts.filter(
      (row) =>
        row.role === "assistant" &&
        row.kind === "text" &&
        row.truth.state !== "distant" &&
        row.truth.slot !== "morning" &&
        row.truth.slot !== "reconcile" &&
        row.truth.slot !== "call",
    ),
  );
  const followReplies = quota(rng, [
    ["人呢", 21],
    ["？", 9],
  ]);
  let followAdded = 0;
  for (const target of followPool) {
    if (followAdded >= 30) break;
    const minutes = 6 + Math.floor(rng() * 7);
    const at = addMs(target.timestamp, minutes * 60_000);
    if (isSleepHour(at) || isWednesdayQuiet(at)) continue;
    const wall = wallClock(at);
    if (wall.hour > 23 || (wall.hour === 23 && wall.minute >= 50)) continue;
    push({
      role: "assistant",
      speaker: XIAOMAN_NAME,
      content: followReplies[followAdded] ?? "人呢",
      timestamp: at,
      kind: "text",
      truth: {
        sceneId: target.truth.sceneId,
        period: target.truth.period,
        state: target.truth.state,
        slot: target.truth.slot,
        locked: true,
        ritual: "follow-up",
        burstSize: 1,
        burstIndex: 0,
        act: "share",
      },
    });
    followAdded++;
  }

  const typoPool = shuffle(
    rng,
    drafts.filter(
      (row) =>
        row.role === "assistant" &&
        row.kind === "text" &&
        !row.truth.locked &&
        row.truth.slot !== "morning" &&
        (row.truth.burstIndex == null || row.truth.burstIndex === 0) &&
        (row.truth.burstSize == null || row.truth.burstSize === 1),
    ),
  ).slice(0, 6);
  typoPool.forEach((target) => {
    target.content = "今天好雷";
    target.truth = { ...target.truth, locked: true, ritual: "typo" };
    push({
      role: "assistant",
      speaker: XIAOMAN_NAME,
      content: "*累",
      timestamp: addMs(target.timestamp, 30_000),
      kind: "text",
      truth: {
        sceneId: target.truth.sceneId,
        period: target.truth.period,
        state: target.truth.state,
        slot: target.truth.slot,
        locked: true,
        ritual: "typo-fix",
        burstSize: 1,
        burstIndex: 0,
      },
    });
  });

  if (options?.withHarm) {
    const harmHosts = main.slice(0, HARM_LINES.length);
    harmHosts.forEach((scene, i) => {
      addTa(scene, shanghaiDate(scene.date.year, scene.date.month, scene.date.day, 22, 10 + i, 0), HARM_LINES[i]!, {
        locked: true,
        ritual: "harm",
        act: "tease",
        burstSize: 1,
        burstIndex: 0,
      });
    });
  }

  retargetMedian(
    drafts.filter((row) => row.role === "assistant" && row.kind === "text" && row.truth.period === "p1"),
    XIAOMAN_TRUTH.taMedianP1,
    rng,
  );
  retargetMedian(
    drafts.filter((row) => row.role === "assistant" && row.kind === "text" && row.truth.period === "p2"),
    XIAOMAN_TRUTH.taMedianP2,
    rng,
  );
  fixBurstGaps(drafts);

  const ordered = [...drafts].sort((a, b) => {
    const dt = a.timestamp.getTime() - b.timestamp.getTime();
    if (dt !== 0) return dt;
    if (a.role !== b.role) return a.role === "user" ? -1 : 1;
    return a.content.localeCompare(b.content, "zh");
  });

  return ordered.map((row, i) => ({ ...row, id: i + 1 }));
}

function hitEnding(
  rows: Draft[],
  adjustable: Draft[],
  ending: string,
  targetCount: number,
  exclusive = true,
): void {
  const have = rows.filter((row) => row.content.endsWith(ending)).length;
  let need = targetCount - have;
  if (need <= 0) return;
  for (const row of adjustable) {
    if (need <= 0) break;
    if (row.content.endsWith(ending)) continue;
    if (row.truth.locked) continue;
    if (exclusive && /[呀啦嘛？]$/u.test(row.content)) continue;
    row.content = withEnding(row.content, ending);
    need--;
  }
}

// i18n:allow-identifier — polishes the designed Chinese log.
function polish(drafts: Draft[], rng: Rng): void {
  const taText = drafts.filter((row) => row.role === "assistant" && row.kind === "text");
  const adjustable = shuffle(
    rng,
    taText.filter((row) => !row.truth.locked && row.truth.state !== "distant"),
  );
  const distant = taText.filter((row) => !row.truth.locked && row.truth.state === "distant");
  const periodEnd = [...DISTANT_PERIOD, "陈树。"];
  const periodPlain = [...DISTANT_PLAIN, "陈树"];

  distant.forEach((row, i) => {
    if (i / Math.max(distant.length, 1) < XIAOMAN_TRUTH.distantPeriodEnd) {
      row.content = pick(rng, periodEnd);
    } else {
      row.content = pick(rng, periodPlain);
    }
    row.truth.act = "acknowledge";
    row.truth.locked = true;
  });

  const p1All = taText.filter((row) => row.truth.period === "p1");
  const p2All = taText.filter((row) => row.truth.period === "p2");
  hitEnding(
    p1All,
    adjustable.filter((row) => row.truth.period === "p1"),
    "？",
    Math.round(p1All.length * XIAOMAN_TRUTH.questionP1),
  );
  hitEnding(
    p2All,
    adjustable.filter((row) => row.truth.period === "p2"),
    "？",
    Math.round(p2All.length * XIAOMAN_TRUTH.questionP2),
  );

  const nonDistant = taText.filter((row) => row.truth.state !== "distant");
  const particlePool = shuffle(
    rng,
    adjustable.filter((row) => !row.content.endsWith("？")),
  );
  hitEnding(nonDistant, particlePool, "呀", Math.round(nonDistant.length * 0.3));
  hitEnding(nonDistant, particlePool, "啦", Math.round(nonDistant.length * 0.2));
  hitEnding(nonDistant, particlePool, "嘛", Math.round(nonDistant.length * 0.1));

  const addressPool = shuffle(
    rng,
    taText.filter((row) => row.truth.state !== "distant" && !row.truth.locked),
  );
  const addressCount = Math.round(taText.length * XIAOMAN_TRUTH.addressRate);
  let addressed = taText.filter((row) => row.content.includes("树树")).length;
  for (const row of addressPool) {
    if (addressed >= addressCount) break;
    if (row.content.includes("树树") || row.content.includes("陈树")) continue;
    row.content = `树树${row.content}`;
    addressed++;
  }

  const laughPool = taText.filter(
    (row) =>
      (row.truth.state === "happy" || row.truth.state === "playful") &&
      !row.truth.locked &&
      !row.content.includes("哈哈哈哈"),
  );
  const happyPlayful = taText.filter((row) => row.truth.state === "happy" || row.truth.state === "playful");
  const laughCount = Math.round(happyPlayful.length * XIAOMAN_TRUTH.laughRate);
  shuffle(rng, laughPool)
    .slice(0, laughCount)
    .forEach((row) => {
      row.content = `哈哈哈哈${row.content}`;
      if (charCount(row.content) > XIAOMAN_TRUTH.taP95Max) {
        row.content = fitLength(row.content, XIAOMAN_TRUTH.taP95Max, ["哈哈哈哈", "树树"]);
      }
      if (!row.content.includes("哈哈哈哈")) row.content = "哈哈哈哈";
      row.truth.act = "tease";
    });

  const keep = ["树树", "哈哈哈哈", "琪琪", "我妈", "咕咕", "香菜", "喜欢海"];
  for (const row of taText) {
    if (row.truth.state === "distant") continue;
    const target = row.truth.period === "p1" ? 10 : 6;
    if (!row.truth.locked) {
      const jitter = Math.floor(rng() * 5) - 2;
      row.content = fitLength(row.content, Math.max(1, target + jitter), keep);
    } else if (charCount(row.content) > XIAOMAN_TRUTH.taP95Max) {
      row.content = fitLength(row.content, XIAOMAN_TRUTH.taP95Max, keep);
    }
  }

  retargetMedian(
    taText.filter((row) => row.truth.period === "p1"),
    XIAOMAN_TRUTH.taMedianP1,
    rng,
  );
  retargetMedian(
    taText.filter((row) => row.truth.period === "p2"),
    XIAOMAN_TRUTH.taMedianP2,
    rng,
  );

  const p1Acts = shuffle(rng, taText.filter((row) => row.truth.period === "p1"));
  const p2Acts = shuffle(rng, taText.filter((row) => row.truth.period === "p2"));
  const affectionN = Math.round(p1Acts.length * XIAOMAN_TRUTH.affectionP1);
  p1Acts.forEach((row, i) => {
    row.truth.act = i < affectionN ? "affection" : pick(rng, ["answer", "share", "tease", "logistics"]);
  });
  const ackN = Math.round(p2Acts.length * XIAOMAN_TRUTH.acknowledgeP2);
  p2Acts.forEach((row, i) => {
    row.truth.act = i < ackN ? "acknowledge" : pick(rng, ["answer", "share", "tease", "deflect"]);
  });

  for (const row of taText) {
    if (row.truth.locked || row.truth.state === "distant") continue;
    if (row.content.includes("呢")) row.content = row.content.replaceAll("呢", "呀");
    if (row.content.includes("呵呵")) row.content = row.content.replaceAll("呵呵", "哈哈");
    if (row.content.includes("～")) row.content = row.content.replaceAll("～", "");
    if (row.content.includes("…")) row.content = row.content.replaceAll("…", "...");
    if (row.content.includes("。。。")) row.content = row.content.replaceAll("。。。", "...");
    if (row.content.endsWith("。")) row.content = row.content.slice(0, -1) + "呀";
  }
}

function fixBurstGaps(rows: Draft[]): void {
  const groups = new Map<number, Draft[]>();
  for (const row of rows) {
    const id = row.truth.burstId;
    if (id == null || row.truth.burstIndex == null) continue;
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.truth.burstIndex ?? 0) - (b.truth.burstIndex ?? 0));
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1]!;
      const cur = group[i]!;
      const gap = charCount(cur.content) * XIAOMAN_TRUTH.burstGapMsPerChar;
      cur.timestamp = safeTaTime(addMs(prev.timestamp, gap));
    }
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// i18n:allow-identifier — keeps designed tokens while padding line length.
function retargetMedian(rows: Draft[], target: number, rng: Rng): void {
  const adjustable = rows.filter((row) => !row.truth.locked && row.kind === "text");
  if (adjustable.length === 0) return;
  const keep = ["树树", "哈哈哈哈", "琪琪", "我妈", "咕咕", "香菜", "喜欢海"];
  for (const row of adjustable) {
    row.content = fitLength(row.content, target, keep);
  }
  for (let step = 0; step < 2000; step++) {
    const current = median(rows.map((row) => charCount(row.content)));
    if (current === target) return;
    const row = pick(rng, adjustable);
    const n = charCount(row.content);
    if (current < target) {
      row.content = fitLength(row.content, Math.min(XIAOMAN_TRUTH.taP95Max, n + 1), keep);
    } else {
      row.content = fitLength(row.content, Math.max(1, n - 1), keep);
    }
  }
}

// i18n:allow-identifier — a stub group log for C9.8, in the same voice.
export function buildGroupFixture(): FixtureRecord[] {
  const rng = seededRandom("xiaoman-group");
  const speakers: Array<{ name: string; role: FixtureRecord["role"] }> = [
    { name: XIAOMAN_USER_NAME, role: "user" },
    { name: XIAOMAN_NAME, role: "assistant" },
    { name: "琪琪", role: "other" },
  ];
  const records: FixtureRecord[] = [];
  let t = shanghaiDate(2024, 1, 8, 19, 0, 0);
  for (let i = 0; i < 300; i++) {
    const who = speakers[i % 3]!;
    t = addMs(t, 20_000 + Math.floor(rng() * 15_000));
    records.push({
      id: i + 1,
      role: who.role,
      speaker: who.name,
      content: who.role === "other" ? "我在呢" : who.role === "assistant" ? "晚上一起呀" : "到了没",
      timestamp: t,
      kind: "text",
      truth: {
        sceneId: 1,
        period: "p2",
        state: "playful",
        slot: "evening",
      },
    });
  }
  return records;
}
