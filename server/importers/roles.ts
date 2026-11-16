import type { ParsedRecord, RecordRole } from "@shared/records";

// i18n:allow-input — matched against names in an export file, not shown.
const ME_LABELS = new Set(["我", "自己", "me", "我方"]);

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Guesses which speakers are the user and which are TA.
 *
 * Returns null when the file has to stop at `needs_roles`.
 */
export function guessRoles(
  speakers: string[],
  names: { personaName?: string | null; userName?: string | null },
): { me: string[]; them: string[] } | null {
  const persona = names.personaName ? keyOf(names.personaName) : "";
  const user = names.userName ? keyOf(names.userName) : "";
  const me: string[] = [];
  const them: string[] = [];
  const leftover: string[] = [];
  for (const raw of speakers) {
    const name = raw.trim();
    if (!name) continue;
    const key = keyOf(name);
    if (persona && key === persona) them.push(name);
    else if (ME_LABELS.has(key) || (user && key === user)) me.push(name);
    else leftover.push(name);
  }
  if (speakers.filter((s) => s.trim()).length === 2) {
    if (me.length === 1 && them.length === 0 && leftover.length === 1) {
      them.push(leftover[0]);
    } else if (them.length === 1 && me.length === 0 && leftover.length === 1) {
      me.push(leftover[0]);
    }
  }
  if (me.length === 0 || them.length === 0) return null;
  return { me, them };
}

export function assignRoles(
  records: ParsedRecord[],
  mapping: { me: string[]; them: string[] },
): Array<ParsedRecord & { role: RecordRole }> {
  const me = new Set(mapping.me.map(keyOf));
  const them = new Set(mapping.them.map(keyOf));
  return records.map((row) => {
    const key = keyOf(row.speaker);
    let role: RecordRole = "other";
    if (row.fromMe === true || me.has(key)) role = "user";
    else if (row.fromMe === false || them.has(key)) role = "assistant";
    return { ...row, role };
  });
}
