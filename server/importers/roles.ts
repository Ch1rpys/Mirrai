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
 *
 * A format that already tagged rows with `fromMe` (WeChat CSV, SMS)
 * is taken at its word: those names are assigned first. Name matching
 * and the two-speaker inference only run on whoever is left.
 */
export function guessRoles(
  speakers: string[],
  names: { personaName?: string | null; userName?: string | null },
  records?: ParsedRecord[],
): { me: string[]; them: string[] } | null {
  const persona = names.personaName ? keyOf(names.personaName) : "";
  const user = names.userName ? keyOf(names.userName) : "";
  const me: string[] = [];
  const them: string[] = [];
  const seen = new Set<string>();

  const take = (bucket: string[], raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const key = keyOf(name);
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(name);
  };

  if (records) {
    const meSeen = new Set<string>();
    const themSeen = new Set<string>();
    for (const row of records) {
      const name = row.speaker.trim();
      if (!name) continue;
      const key = keyOf(name);
      if (row.fromMe === true && !meSeen.has(key)) {
        me.push(name);
        meSeen.add(key);
      }
      if (row.fromMe === false && !themSeen.has(key)) {
        them.push(name);
        themSeen.add(key);
      }
    }
    for (const key of [...meSeen, ...themSeen]) seen.add(key);
    // A format that tagged every row (WeChat CSV IsSender, SMS type)
    // has already named the two sides, even when both rows carry the
    // same display name.
    if (me.length > 0 && them.length > 0) return { me, them };
  }

  const leftover: string[] = [];
  for (const raw of speakers) {
    const name = raw.trim();
    if (!name) continue;
    const key = keyOf(name);
    if (seen.has(key)) continue;
    if (persona && key === persona) take(them, name);
    else if (ME_LABELS.has(key) || (user && key === user)) take(me, name);
    else leftover.push(name);
  }

  const named = speakers.filter((s) => s.trim());
  if (named.length === 2) {
    if (me.length === 1 && them.length === 0 && leftover.length === 1) {
      take(them, leftover[0]);
    } else if (them.length === 1 && me.length === 0 && leftover.length === 1) {
      take(me, leftover[0]);
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
    if (row.fromMe === true) role = "user";
    else if (row.fromMe === false) role = "assistant";
    else if (me.has(key)) role = "user";
    else if (them.has(key)) role = "assistant";
    return { ...row, role };
  });
}
