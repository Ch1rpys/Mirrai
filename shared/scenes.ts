/**
 * Scenes and turns.
 *
 * A scene is a stretch of the record with no long silence in it. A turn
 * is one person sending one or more lines in a row (a burst). The
 * evaluation's scene-break window and every later measurement share
 * this file — there is one ruler.
 */

export const DEFAULT_SCENE_BREAK_HOURS = 6;

function spokenAt(row: { timestamp?: Date | string | null }): number | null {
  if (!row.timestamp) return null;
  const time =
    row.timestamp instanceof Date
      ? row.timestamp.getTime()
      : new Date(row.timestamp).getTime();
  return Number.isNaN(time) ? null : time;
}

function speakerKey(row: { role: string; speaker?: string | null }): string {
  const speaker = typeof row.speaker === "string" ? row.speaker.trim() : "";
  return speaker || row.role;
}

/**
 * Splits a time-ordered record into scenes.
 *
 * Adjacent rows more than `breakHours` apart start a new scene. The
 * source does not matter: a WeChat line and an SMS line in the same
 * stretch are one scene. Rows with no timestamp never open a break,
 * because there is no gap to measure.
 *
 * The input is assumed to be in the order it was said. This function
 * does not sort.
 */
export function splitScenes<T extends { timestamp?: Date | string | null }>(
  rows: T[],
  breakHours = DEFAULT_SCENE_BREAK_HOURS,
): T[][] {
  if (rows.length === 0) return [];
  const breakMs = breakHours * 3_600_000;
  const scenes: T[][] = [];
  let current: T[] = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    const previous = spokenAt(rows[i - 1]);
    const next = spokenAt(rows[i]);
    if (previous !== null && next !== null && next - previous > breakMs) {
      scenes.push(current);
      current = [rows[i]];
    } else {
      current.push(rows[i]);
    }
  }
  scenes.push(current);
  return scenes;
}

/**
 * Groups consecutive lines from the same person into a turn.
 *
 * The person is the speaker when the row has one, otherwise the role.
 * Two people who happen to share a role (`other`) stay separate when
 * their names differ.
 */
export function toTurns<T extends { role: string; speaker?: string | null }>(
  rows: T[],
): T[][] {
  if (rows.length === 0) return [];
  const turns: T[][] = [];
  let current: T[] = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    if (speakerKey(rows[i]) === speakerKey(current[0])) {
      current.push(rows[i]);
    } else {
      turns.push(current);
      current = [rows[i]];
    }
  }
  turns.push(current);
  return turns;
}
