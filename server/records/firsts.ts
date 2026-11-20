/**
 * The firsts and the lasts (C2.6)
 *
 * The first thing each of them said, the first goodnight, the first
 * time they said they loved each other, the first fight, the first
 * photo, the first and last call. Only what is in the record: a first
 * that never happened is not shown.
 */
import { normalizeTrigger } from "@shared/ritual-table";
import { isTextRecord } from "@shared/records";
import { splitScenes, toTurns } from "@shared/scenes";

export interface FirstRow {
  id: number;
  role: string;
  content: string;
  kind: string;
  timestamp: Date | null;
  createdAt: Date;
  /** The B1.5 label, on the record's own column. */
  emotion?: string | null;
  meta?: unknown;
}

export interface FirstItem {
  key: string;
  recordId: number;
  at: string;
  text: string;
  side: "me" | "them" | "both";
}

// i18n:allow-input — matched against the record, never shown as copy.
// A negated line ("我不爱你了") is not a declaration of love.
const LOVE_RE = /(?<!不)(?:我爱你|爱你|喜欢你|love you)/i;
const NEGATIVE = new Set(["distant", "melancholy"]);

function atOf(row: FirstRow): Date {
  return row.timestamp ?? row.createdAt;
}

function sideOf(row: FirstRow): "me" | "them" | null {
  if (row.role === "user") return "me";
  if (row.role === "assistant") return "them";
  return null;
}

function textOf(row: FirstRow): string {
  return String(row.content ?? "").trim();
}

// i18n:allow-input — 「晚安」「早」 are matched against the record's own lines.
export function findFirsts(
  rows: FirstRow[],
  extras: { conflict?: unknown } = {},
): FirstItem[] {
  const sorted = [...rows].sort((a, b) => atOf(a).getTime() - atOf(b).getTime() || a.id - b.id);
  const texts = sorted.filter((row) => isTextRecord(row) && textOf(row));
  const item = (key: string, row: FirstRow): FirstItem => ({
    key,
    recordId: row.id,
    at: atOf(row).toISOString(),
    text: textOf(row),
    side: sideOf(row) ?? "both",
  });

  const firsts: FirstItem[] = [];
  if (texts[0]) firsts.push(item("firstLine", texts[0]));
  if (texts.length > 1) firsts.push(item("lastLine", texts[texts.length - 1]));

  const firstBy = (key: string, predicate: (row: FirstRow) => boolean, side?: "me" | "them") => {
    const row = texts.find((candidate) => predicate(candidate) && (!side || sideOf(candidate) === side));
    if (row) firsts.push(item(key, row));
  };

  const turns = toTurns(sorted);
  /**
   * The other side's goodnight is the reply to *my* goodnight.
   *
   * A "晚安" somewhere in the middle of a conversation is not the
   * goodnight either of them means; the exchange is the unit.
   */
  const firstReplyAfter = (trigger: string): FirstRow | null => {
    for (let index = 0; index + 1 < turns.length; index++) {
      const left = turns[index];
      const right = turns[index + 1];
      if (sideOf(left[0]) !== "me" || sideOf(right[0]) !== "them") continue;
      if (!left.some((row) => normalizeTrigger(textOf(row)) === trigger)) continue;
      const reply = right.find((row) => isTextRecord(row) && textOf(row));
      if (reply) return reply;
    }
    return null;
  };

  const firstGoodnightMe = texts.find(
    (row) => sideOf(row) === "me" && normalizeTrigger(textOf(row)) === "晚安",
  );
  if (firstGoodnightMe) firsts.push(item("firstGoodnightMe", firstGoodnightMe));
  const firstGoodnightThem = firstReplyAfter("晚安");
  if (firstGoodnightThem) firsts.push(item("firstGoodnightThem", firstGoodnightThem));

  const firstMorningMe = texts.find(
    (row) => sideOf(row) === "me" && normalizeTrigger(textOf(row)) === "早",
  );
  if (firstMorningMe) firsts.push(item("firstMorningMe", firstMorningMe));
  const firstMorningThem = firstReplyAfter("早");
  if (firstMorningThem) firsts.push(item("firstMorningThem", firstMorningThem));

  for (const side of ["me", "them"] as const) {
    firstBy(side === "me" ? "firstLoveMe" : "firstLoveThem", (row) => LOVE_RE.test(textOf(row)), side);
  }

  /**
   * The first fight: the first time they went cold after being warm.
   * Only when the conflict measurement found one.
   */
  if (extras.conflict) {
    /**
     * The start of the scene in which they first went cold, not the
     * cold line itself: the fight began with the exchange that led to
     * it, and the reader jumps to its first line.
     */
    const scene = splitScenes(sorted).find((candidate) =>
      candidate.some((row) => {
        if (!isTextRecord(row) || sideOf(row) !== "them") return false;
        const emotion = row.emotion;
        return typeof emotion === "string" && NEGATIVE.has(emotion);
      }),
    );
    if (scene?.[0]) firsts.push({ ...item("firstFight", scene[0]), side: sideOf(scene[0]) ?? "both" });
  }

  const firstKind = (key: string, kind: string) => {
    const row = sorted.find((candidate) => candidate.kind === kind);
    if (row) firsts.push(item(key, row));
  };
  firstKind("firstPhoto", "image");
  firstKind("firstSticker", "sticker");
  firstKind("firstVoice", "voice");

  const calls = sorted.filter((row) => row.kind === "call");
  if (calls.length > 0) {
    firsts.push(item("firstCall", calls[0]));
    firsts.push(item("lastCall", calls[calls.length - 1]));
    const longest = [...calls].sort((a, b) => {
      const aDuration = Number((a.meta as { durationSec?: unknown } | null)?.durationSec ?? 0);
      const bDuration = Number((b.meta as { durationSec?: unknown } | null)?.durationSec ?? 0);
      return bDuration - aDuration || a.id - b.id;
    })[0];
    firsts.push(item("longestCall", longest));
  }

  return firsts.sort((a, b) => a.at.localeCompare(b.at) || a.recordId - b.recordId);
}
