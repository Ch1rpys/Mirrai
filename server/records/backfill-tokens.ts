/**
 * Filling in the search tokens of rows that predate C8.6.
 *
 * The importers write the tokens with each row. Rows collected before
 * the column existed have none, and a search would not find them; this
 * sweep fills them in two thousand at a time, after the app has
 * started, so a large history does not hold up boot.
 *
 * It is re-entrant: a second run simply finds fewer (or no) missing
 * rows.
 */
import { backfillSearchTokenBatch, countMissingSearchTokens } from "../db";

export interface BackfillResult {
  records: number;
  messages: number;
}

export interface BackfillOptions {
  batchSize?: number;
  /** Stop after this many rows in total, for tests and one-off runs. */
  maxRows?: number;
  /** Called between batches; defaults to yielding to the event loop. */
  betweenBatches?: () => Promise<void> | void;
}

const setImmediatePromise = () =>
  new Promise<void>((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });

export async function backfillSearchTokens(
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const batchSize = Math.max(1, options.batchSize ?? 2000);
  const between = options.betweenBatches ?? setImmediatePromise;
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const result: BackfillResult = { records: 0, messages: 0 };
  for (const kind of ["records", "messages"] as const) {
    for (;;) {
      if (result.records + result.messages >= maxRows) return result;
      const written = await backfillSearchTokenBatch(kind, batchSize);
      result[kind] += written;
      if (written < batchSize) break;
      await between();
    }
  }
  return result;
}

/** The number of rows still waiting for their tokens. */
export async function missingSearchTokenRows(): Promise<BackfillResult> {
  return {
    records: await countMissingSearchTokens("records"),
    messages: await countMissingSearchTokens("messages"),
  };
}

const running = new Set<string>();

/** Starts one background sweep for this process. */
export function scheduleSearchTokenBackfill(): void {
  const key = "all";
  if (running.has(key)) return;
  running.add(key);
  void backfillSearchTokens()
    .then((result) => {
      if (result.records + result.messages > 0) {
        console.log(
          `[Search] Filled search tokens for ${result.records} record(s) and ${result.messages} message(s)`,
        );
      }
    })
    .catch((error) => {
      console.warn("[Search] The token backfill stopped:", error);
    })
    .finally(() => running.delete(key));
}
