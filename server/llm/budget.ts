/**
 * The monthly ceiling (C8.9).
 *
 * A user can say "do not spend more than this a month". When the month
 * passes the ceiling, the optional expensive layers stop on their own:
 * the four-way rerank, two-stage generation, the fact rewrite, the
 * evaluation runs, the audition, the rehearsal room and the wording
 * assistant. Ordinary replies, the safety paths and memory extraction
 * keep working — those are the app doing what it promised, and a
 * ceiling must not switch them off.
 *
 * The month is the user's own month, not the server's.
 */
import { parseZoneless, zonedDateKey } from "@shared/timezone";
import { getUserBudget, sumLlmUsageByPurpose } from "../db";

/** What the user allows in a month. Both fields are optional. */
export interface BudgetAmounts {
  monthlyTokens?: number;
  monthlyCost?: number;
}

/**
 * A stored budget, or null.
 *
 * A malformed value is treated as "no ceiling" rather than as zero: a
 * typo must not be able to switch something off.
 */
export function normalizeBudget(value: unknown): BudgetAmounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const budget: BudgetAmounts = {};
  const tokens = Number(record.monthlyTokens);
  if (Number.isFinite(tokens) && tokens > 0) {
    budget.monthlyTokens = Math.floor(tokens);
  }
  const cost = Number(record.monthlyCost);
  if (Number.isFinite(cost) && cost > 0) {
    budget.monthlyCost = cost;
  }
  return budget.monthlyTokens != null || budget.monthlyCost != null ? budget : null;
}

/**
 * The first instant of the user's current month.
 *
 * A wall-clock month start in the user's zone, turned into an instant —
 * so a user in Shanghai and one in Berlin each get their own month
 * boundary. Records store instants (`timestamptz`), so this is a
 * comparison that means what it says.
 */
export function monthStartInstant(now: Date, timeZone?: string | null): Date {
  const zone = timeZone || "UTC";
  const dayKey = zonedDateKey(now, zone);
  const monthKey = `${dayKey.slice(0, 7)}-01`;
  const start = parseZoneless(`${monthKey} 00:00`, zone);
  return start ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface BudgetState {
  /** The user's ceiling; null when they have not set one. */
  budget: BudgetAmounts | null;
  over: boolean;
  tokens: number;
  costMicros: number;
  /** The start of the month being counted, as an ISO instant. */
  monthStart: string;
}

/**
 * How much of the month's budget is used.
 *
 * One grouped query, so the chat page can ask on every visit without
 * making the turn itself heavier.
 */
export async function budgetStateForUser(
  userId: number,
  timeZone?: string | null,
  now: Date = new Date(),
): Promise<BudgetState> {
  const monthStart = monthStartInstant(now, timeZone);
  const budget = normalizeBudget(await getUserBudget(userId).catch(() => null));
  const purposes = await sumLlmUsageByPurpose(userId, monthStart).catch(() => []);
  const tokens = purposes.reduce(
    (sum, row) => sum + row.promptTokens + row.completionTokens,
    0,
  );
  const costMicros = purposes.reduce((sum, row) => sum + row.costMicros, 0);
  const over = Boolean(
    budget &&
      ((budget.monthlyTokens != null && tokens >= budget.monthlyTokens) ||
        (budget.monthlyCost != null && costMicros >= budget.monthlyCost * 1_000_000)),
  );
  return {
    budget,
    over,
    tokens,
    costMicros,
    monthStart: monthStart.toISOString(),
  };
}

/**
 * Whether the expensive layers have to stay off this month.
 *
 * Never throws: a database that cannot be read must not stop a reply.
 */
export async function budgetExceeded(
  userId: number,
  timeZone?: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    return (await budgetStateForUser(userId, timeZone, now)).over;
  } catch {
    return false;
  }
}
