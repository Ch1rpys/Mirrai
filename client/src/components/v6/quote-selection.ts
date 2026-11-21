/**
 * A stretch of the record on its way to a conversation (C8.10).
 *
 * The reader selects a few consecutive lines and jumps to the chat with
 * them. The lines themselves travel through `sessionStorage` — the URL
 * carries only "there is a quotation" — so a long line is not copied
 * into browser history, and the server is still the one that checks and
 * reads the records when the turn is sent.
 */
export interface QuoteLine {
  id: number;
  role: string;
  speaker: string | null;
  content: string;
  timestamp: string | null;
}

const PREFIX = "mirrai:quote:";

function keyFor(personaId: number): string {
  return `${PREFIX}${personaId}`;
}

export function writeQuoteDraft(personaId: number, lines: QuoteLine[]): void {
  try {
    sessionStorage.setItem(keyFor(personaId), JSON.stringify(lines));
  } catch {
    // No storage: the chat page simply opens without the quotation.
  }
}

export function readQuoteDraft(personaId: number): QuoteLine[] {
  try {
    const raw = sessionStorage.getItem(keyFor(personaId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is QuoteLine => Boolean(
        row &&
        typeof row === "object" &&
        typeof (row as QuoteLine).id === "number" &&
        typeof (row as QuoteLine).content === "string",
      ))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function clearQuoteDraft(personaId: number): void {
  try {
    sessionStorage.removeItem(keyFor(personaId));
  } catch {
    // Nothing to clear.
  }
}
