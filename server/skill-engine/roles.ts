/**
 * The role names the v5 miners already know.
 *
 * Distillation used to keep whatever the transcript parser wrote —
 * `persona`, a leftover nickname, an empty string — and then hand
 * those rows to functions that only count `user` and `assistant`. The
 * mapping lives here so the miners stay as they are.
 */

export type MinerRole = "user" | "assistant" | "other";

export type ParsedSpeakerRow = {
  role?: string;
  content: string;
  timestamp?: Date | string | null;
};

export type MinerRow = {
  role: MinerRole;
  content: string;
  timestamp: Date | string | null;
};

function keyOf(role: string): string {
  return role.trim().toLowerCase();
}

function isThem(role: string, personaName?: string): boolean {
  const key = keyOf(role);
  if (!key) return false;
  if (key === "persona" || key === "assistant") return true;
  const wanted = (personaName ?? "").trim().toLowerCase();
  return Boolean(wanted) && key === wanted;
}

function isMe(role: string): boolean {
  return keyOf(role) === "user";
}

/**
 * Maps a parsed transcript onto `user` / `assistant` / `other`.
 *
 * `persona` becomes `assistant`. A leftover name becomes `user` only
 * when the whole log has exactly two named speakers and one of them
 * is TA; otherwise leftover names are `other`. Unnamed lines are
 * `other`.
 */
export function toMinerRows(
  parsed: ParsedSpeakerRow[],
  personaName?: string,
): MinerRow[] {
  const named = new Set<string>();
  for (const row of parsed) {
    const key = keyOf(row.role ?? "");
    if (key) named.add(key);
  }
  const leftover = [...named].filter((key) => !isThem(key, personaName) && !isMe(key));
  const themKeys = [...named].filter((key) => isThem(key, personaName));
  const promote =
    named.size === 2 && themKeys.length === 1 && leftover.length === 1 ? leftover[0] : null;

  return parsed.map((row) => {
    const key = keyOf(row.role ?? "");
    let role: MinerRole;
    if (!key) role = "other";
    else if (isThem(key, personaName)) role = "assistant";
    else if (isMe(key)) role = "user";
    else if (promote && key === promote) role = "user";
    else role = "other";
    return {
      role,
      content: row.content,
      timestamp: row.timestamp ?? null,
    };
  });
}
