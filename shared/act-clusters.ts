/**
 * How they say the same kind of turn.
 *
 * An action is a verb. Under it, the same person still has a few
 * shapes they actually used — "就嗯？" is not "哼". Clustering the
 * original lines, then putting one from each of the largest clusters
 * next to the action instruction, is how the model sees the shapes
 * rather than a personality paragraph.
 */
import { filterHarm } from "./harm";
import { isTextRecord } from "./records";
import { SPEECH_ACTS, isSpeechAct, type SpeechAct } from "./speech-acts";

export const ACT_CLUSTER_MIN_LINES = 12;
export const ACT_CLUSTER_SIMILARITY = 0.5;
export const ACT_CLUSTER_SAMPLE_CAP = 2000;
export const ACT_CLUSTER_KEEP = 5;
export const ACT_CLUSTER_LINES_PER = 3;
export const ACT_CLUSTER_PROMPT = 3;

export interface ActCluster {
  size: number;
  lines: string[];
}

export type ActClusters = Partial<Record<SpeechAct, ActCluster[]>>;

export interface ActClusterLine {
  text: string;
  at?: Date | string | null;
}

function compactChars(text: string): string[] {
  return Array.from(String(text ?? "").replace(/\s+/g, ""));
}

/** Character bigrams of the compacted line. A single character is kept. */
export function charBigrams(text: string): Set<string> {
  const chars = compactChars(text);
  const out = new Set<string>();
  if (chars.length === 0) return out;
  if (chars.length === 1) {
    out.add(chars[0]!);
    return out;
  }
  for (let i = 0; i < chars.length - 1; i++) {
    out.add(chars[i]! + chars[i + 1]!);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function spokenAt(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** Evenly spaced sample across a time-ordered list, without duplicates. */
export function sampleEvenly<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const out: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < cap; i++) {
    const index = Math.min(items.length - 1, Math.floor((i * items.length) / cap));
    if (seen.has(index)) continue;
    seen.add(index);
    out.push(items[index]!);
  }
  return out;
}

/**
 * Greedy clusters in appearance order.
 *
 * Each line is compared to the representative of every cluster already
 * open. The highest Jaccard at or above 0.5 takes it; otherwise it
 * opens a cluster of its own.
 */
export function clusterActLines(lines: ActClusterLine[]): ActCluster[] | null {
  const ordered = [...lines]
    .map((row) => ({ text: String(row.text ?? "").trim(), at: row.at }))
    .filter((row) => row.text);
  if (ordered.length < ACT_CLUSTER_MIN_LINES) return null;
  ordered.sort((a, b) => spokenAt(a.at) - spokenAt(b.at));
  const sampled = sampleEvenly(ordered, ACT_CLUSTER_SAMPLE_CAP);
  if (sampled.length < ACT_CLUSTER_MIN_LINES) return null;

  const clusters: Array<{ representative: string; members: string[]; bigrams: Set<string> }> = [];
  for (const row of sampled) {
    const bigrams = charBigrams(row.text);
    let bestAt = -1;
    let best = -1;
    for (let i = 0; i < clusters.length; i++) {
      const score = jaccard(bigrams, clusters[i]!.bigrams);
      if (score > best) {
        best = score;
        bestAt = i;
      }
    }
    if (bestAt >= 0 && best >= ACT_CLUSTER_SIMILARITY) {
      clusters[bestAt]!.members.push(row.text);
    } else {
      clusters.push({ representative: row.text, members: [row.text], bigrams });
    }
  }

  const ranked = clusters
    .map((cluster) => {
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const line of [cluster.representative, ...cluster.members]) {
        if (seen.has(line)) continue;
        seen.add(line);
        unique.push(line);
        if (unique.length >= ACT_CLUSTER_LINES_PER) break;
      }
      return { size: cluster.members.length, lines: unique };
    })
    .sort((a, b) => b.size - a.size || (a.lines[0] ?? "").localeCompare(b.lines[0] ?? ""));
  return ranked.slice(0, ACT_CLUSTER_KEEP);
}

export function pickActClusterLines(
  clusters: ActCluster[],
  rng: () => number,
  max = ACT_CLUSTER_PROMPT,
): string[] {
  const top = [...clusters]
    .sort((a, b) => b.size - a.size || (a.lines[0] ?? "").localeCompare(b.lines[0] ?? ""))
    .slice(0, max);
  const picked: string[] = [];
  for (const cluster of top) {
    if (cluster.lines.length === 0) continue;
    const index = Math.min(
      cluster.lines.length - 1,
      Math.max(0, Math.floor(rng() * cluster.lines.length)),
    );
    const line = cluster.lines[index];
    if (line) picked.push(line);
  }
  return picked;
}

export function measureActClusters(
  rows: Array<{
    role: string;
    content: string;
    kind?: string | null;
    act?: string | null;
    timestamp?: Date | string | null;
  }>,
  personaData?: { harmReport?: unknown } | null,
): ActClusters | null {
  const kept = filterHarm(
    rows.filter((row) => row.role === "assistant" && isTextRecord(row) && isSpeechAct(row.act)),
    personaData as { harmReport?: never } | null,
  );
  const byAct = new Map<SpeechAct, ActClusterLine[]>();
  for (const row of kept) {
    if (!isSpeechAct(row.act)) continue;
    const text = String(row.content ?? "").trim();
    if (!text) continue;
    const list = byAct.get(row.act) ?? [];
    list.push({ text, at: row.timestamp });
    byAct.set(row.act, list);
  }
  const out: ActClusters = {};
  for (const act of SPEECH_ACTS) {
    const clustered = clusterActLines(byAct.get(act) ?? []);
    if (clustered) out[act] = clustered;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function normalizeActClusters(value: unknown): ActClusters | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const out: ActClusters = {};
  for (const act of SPEECH_ACTS) {
    const raw = record[act];
    if (!Array.isArray(raw)) continue;
    const clusters: ActCluster[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const lines = Array.isArray(row.lines)
        ? row.lines.map((line) => String(line ?? "").trim()).filter(Boolean)
        : [];
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const line of lines) {
        if (seen.has(line)) continue;
        seen.add(line);
        unique.push(line);
        if (unique.length >= ACT_CLUSTER_LINES_PER) break;
      }
      if (unique.length === 0) continue;
      const size = Math.max(unique.length, Math.round(Number(row.size) || 0));
      clusters.push({ size, lines: unique });
    }
    if (clusters.length > 0) out[act] = clusters.slice(0, ACT_CLUSTER_KEEP);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
