/**
 * Cold stretches in the records, and how they used to end.
 *
 * A distant evening is not automatically a fight. The fights that
 * leave a script are the ones that went quiet: a short flare, a
 * freeze of a few hours, then someone spoke first. Those are the
 * lines we keep — the cold ones, and the ones that made up.
 */
import { filterHarm } from "./harm";
import { isTextRecord } from "./records";
import { isUserAct, labelUserActByRule, type UserAct } from "./speech-acts";

export const CONFLICT_MIN_EPISODES = 3;
export const CONFLICT_MAX_GAP_MS = 48 * 3_600_000;
/** Shorter than this is chatting while cold, not a freeze. */
export const CONFLICT_FREEZE_MIN_MS = 2 * 3_600_000;
/** Longer than this is overnight, not this fight. */
export const CONFLICT_FREEZE_MAX_MS = 9 * 3_600_000;
/** A freeze after a long distant conversation is not the same shape. */
export const CONFLICT_MAX_TA_BEFORE_FREEZE = 8;
export const CONFLICT_COLD_PER_EPISODE = 3;
export const CONFLICT_COLD_MAX = 8;
export const CONFLICT_REPAIR_MAX = 5;
export const CONFLICT_THEM_REPAIR_MIN = 0.4;

const NEGATIVE = new Set(["distant", "melancholy"]);

export interface ConflictLine {
  role: string;
  content?: string | null;
  timestamp?: Date | string | null;
  kind?: string | null;
  emotion?: string | null;
  act?: string | null;
  id?: number;
}

export type ConflictScene = ConflictLine[];

export interface ConflictTrigger {
  text: string;
  userAct: UserAct;
  recordId?: number;
}

export interface ConflictEpisode {
  startAt: number;
  durationMin: number;
  trigger: ConflictTrigger;
  repairBy: "them" | "me";
  repairLine?: string;
  coldLines: string[];
  /** When I spoke first, they came back to a non-negative state in the same scene. */
  repairAccepted: boolean;
}

export interface ConflictProfile {
  episodes: number;
  durationMin: { median: number; p25: number; p75: number; all: number[] };
  repairBy: { them: number; me: number };
  /** After I opened, they returned to a non-negative state in the same scene. */
  repairAcceptRate: number;
  repairLines: string[];
  coldLines: string[];
}

function spokenAt(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function isNegative(value: string | null | undefined): boolean {
  return typeof value === "string" && NEGATIVE.has(value);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function uniqueTake(lines: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const text = raw.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function triggerAct(line: FlatLine | undefined): UserAct {
  if (!line) return "other";
  if (isUserAct(line.act)) return line.act;
  return labelUserActByRule(line.content) ?? "other";
}

interface FlatLine {
  role: string;
  content: string;
  at: number;
  emotion: string | null;
  act: string | null;
  id?: number;
  scene: number;
}

function flattenScenes(scenes: ConflictScene[]): FlatLine[] {
  const out: FlatLine[] = [];
  scenes.forEach((scene, sceneIndex) => {
    for (const row of scene) {
      if (row.role !== "user" && row.role !== "assistant") continue;
      if (!isTextRecord(row)) continue;
      const at = spokenAt(row.timestamp);
      if (at == null) continue;
      const content = String(row.content ?? "").trim();
      if (!content) continue;
      out.push({
        role: row.role,
        content,
        at,
        emotion: typeof row.emotion === "string" ? row.emotion : null,
        act: typeof row.act === "string" ? row.act : null,
        id: typeof row.id === "number" ? row.id : undefined,
        scene: sceneIndex,
      });
    }
  });
  out.sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
  return out;
}

function lastAssistantBefore(lines: FlatLine[], from: number, start: number): number {
  for (let i = from; i >= start; i--) {
    if (lines[i]?.role === "assistant") return i;
  }
  return -1;
}

function lastUserBefore(lines: FlatLine[], index: number): FlatLine | undefined {
  for (let i = index; i >= 0; i--) {
    if (lines[i]?.role === "user") return lines[i];
  }
  return undefined;
}

function coldFromStretch(lines: FlatLine[], start: number, recovery: number): string[] {
  const texts: string[] = [];
  for (let i = start; i < recovery; i++) {
    const row = lines[i]!;
    if (row.role !== "assistant") continue;
    if (!/。$/.test(row.content)) continue;
    texts.push(row.content);
  }
  return uniqueTake(texts, CONFLICT_COLD_PER_EPISODE);
}

/**
 * Each freeze that used to sit between a cold flare and a recovery.
 *
 * Ordinary distant chats are dropped: they talk through the mood. A
 * fight in the records went quiet for a few hours first.
 */
export function mineConflictEpisodes(scenes: ConflictScene[]): ConflictEpisode[] {
  const lines = flattenScenes(scenes);
  const episodes: ConflictEpisode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.role !== "assistant" || !isNegative(line.emotion)) {
      i += 1;
      continue;
    }
    const stretchStart = i;
    let j = i + 1;
    let recovery = -1;
    while (j < lines.length) {
      if (lines[j]!.at - lines[j - 1]!.at > CONFLICT_MAX_GAP_MS) break;
      if (lines[j]!.role === "assistant" && !isNegative(lines[j]!.emotion)) {
        recovery = j;
        break;
      }
      j += 1;
    }
    if (recovery < 0) {
      i = j > i ? j : i + 1;
      continue;
    }

    let maxGap = 0;
    let after = stretchStart;
    for (let k = stretchStart + 1; k <= recovery; k++) {
      const gap = lines[k]!.at - lines[k - 1]!.at;
      if (gap >= maxGap) {
        maxGap = gap;
        after = k;
      }
    }
    if (maxGap < CONFLICT_FREEZE_MIN_MS || maxGap > CONFLICT_FREEZE_MAX_MS) {
      i = recovery;
      continue;
    }

    const nTa = lines.slice(stretchStart, after).filter((row) => row.role === "assistant").length;
    if (nTa === 0 || nTa > CONFLICT_MAX_TA_BEFORE_FREEZE) {
      i = recovery;
      continue;
    }

    const freezeFrom = lastAssistantBefore(lines, after - 1, stretchStart);
    const opener = freezeFrom >= 0 ? lines[freezeFrom] : undefined;
    if (!opener || !isNegative(opener.emotion)) {
      i = recovery;
      continue;
    }

    const afterLine = lines[after]!;
    const repairBy: "them" | "me" = afterLine.role === "assistant" ? "them" : "me";
    const recovered = lines[recovery]!;
    const triggerLine = lastUserBefore(lines, freezeFrom);
    const durationMin = Math.round((recovered.at - opener.at) / 60_000);
    if (durationMin < 1) {
      i = recovery;
      continue;
    }

    episodes.push({
      startAt: opener.at,
      durationMin,
      trigger: {
        text: triggerLine?.content ?? "",
        userAct: triggerAct(triggerLine),
        ...(triggerLine?.id != null ? { recordId: triggerLine.id } : {}),
      },
      repairBy,
      ...(repairBy === "them" ? { repairLine: afterLine.content } : {}),
      coldLines: coldFromStretch(lines, stretchStart, recovery),
      repairAccepted: repairBy === "me" && recovered.scene === afterLine.scene,
    });
    i = recovery;
  }
  return episodes;
}

export function summarizeConflicts(
  episodes: ConflictEpisode[],
  personaData?: { harmReport?: unknown } | null,
): ConflictProfile | null {
  if (episodes.length < CONFLICT_MIN_EPISODES) return null;
  const all = episodes.map((row) => row.durationMin).sort((a, b) => a - b);
  let them = 0;
  let me = 0;
  let accepted = 0;
  const repairRaw: string[] = [];
  const coldRaw: string[] = [];
  for (const episode of episodes) {
    if (episode.repairBy === "them") {
      them += 1;
      if (episode.repairLine) repairRaw.push(episode.repairLine);
    } else {
      me += 1;
      if (episode.repairAccepted) accepted += 1;
    }
    coldRaw.push(...episode.coldLines);
  }
  const harm = personaData as { harmReport?: never } | null | undefined;
  const repairLines = uniqueTake(
    filterHarm(
      repairRaw.map((content) => ({ content, role: "assistant" as const })),
      harm,
    ).map((row) => String(row.content ?? "")),
    CONFLICT_REPAIR_MAX,
  );
  const coldLines = uniqueTake(
    filterHarm(
      coldRaw.map((content) => ({ content, role: "assistant" as const })),
      harm,
    ).map((row) => String(row.content ?? "")),
    CONFLICT_COLD_MAX,
  );
  return {
    episodes: episodes.length,
    durationMin: {
      median: quantile(all, 0.5),
      p25: quantile(all, 0.25),
      p75: quantile(all, 0.75),
      all,
    },
    repairBy: { them, me },
    repairAcceptRate: me > 0 ? accepted / me : 0,
    repairLines,
    coldLines,
  };
}

export function mineConflicts(
  scenes: ConflictScene[],
  personaData?: { harmReport?: unknown } | null,
): ConflictProfile | null {
  return summarizeConflicts(mineConflictEpisodes(scenes), personaData);
}

export function pickConflictDuration(all: number[], random: () => number): number | null {
  if (all.length === 0) return null;
  const index = Math.min(all.length - 1, Math.max(0, Math.floor(random() * all.length)));
  return all[index] ?? null;
}

export function shouldForceRepair(input: {
  state: string;
  sinceMin: number;
  profile: ConflictProfile;
  random: () => number;
}): boolean {
  if (!isNegative(input.state)) return false;
  const total = input.profile.repairBy.them + input.profile.repairBy.me;
  if (total === 0 || input.profile.repairBy.them / total < CONFLICT_THEM_REPAIR_MIN) {
    return false;
  }
  const duration = pickConflictDuration(input.profile.durationMin.all, input.random);
  if (duration == null) return false;
  return input.sinceMin > duration;
}

export function normalizeConflictProfile(value: unknown): ConflictProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const durationRaw = source.durationMin;
  const all = Array.isArray((durationRaw as { all?: unknown } | undefined)?.all)
    ? (durationRaw as { all: unknown[] }).all
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
    : [];
  const them = Math.max(0, Math.round(Number((source.repairBy as { them?: unknown } | undefined)?.them) || 0));
  const me = Math.max(0, Math.round(Number((source.repairBy as { me?: unknown } | undefined)?.me) || 0));
  const episodes = Math.max(0, Math.round(Number(source.episodes) || 0));
  const repairAcceptRate = Number(source.repairAcceptRate);
  const repairLines = Array.isArray(source.repairLines)
    ? uniqueTake(source.repairLines.map((line) => String(line ?? "")), CONFLICT_REPAIR_MAX)
    : [];
  const coldLines = Array.isArray(source.coldLines)
    ? uniqueTake(source.coldLines.map((line) => String(line ?? "")), CONFLICT_COLD_MAX)
    : [];
  if (episodes < 1 || all.length === 0) return undefined;
  const sorted = [...all].sort((a, b) => a - b);
  return {
    episodes,
    durationMin: {
      median: Number((durationRaw as { median?: unknown } | undefined)?.median) || quantile(sorted, 0.5),
      p25: Number((durationRaw as { p25?: unknown } | undefined)?.p25) || quantile(sorted, 0.25),
      p75: Number((durationRaw as { p75?: unknown } | undefined)?.p75) || quantile(sorted, 0.75),
      all: sorted,
    },
    repairBy: { them, me },
    repairAcceptRate: Number.isFinite(repairAcceptRate) ? repairAcceptRate : 0,
    repairLines,
    coldLines,
  };
}
