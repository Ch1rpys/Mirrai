/**
 * Fills in the search tokens of rows imported before C8.6.
 *
 * Usage:
 *   DATABASE_URL=postgresql://… node node_modules/tsx/dist/cli.mjs scripts/backfill-search-tokens.ts
 *
 * The app runs the same sweep in the background after it starts; this
 * script is for an operator who wants to see it finish.
 */
import "dotenv/config";
import { backfillSearchTokens, missingSearchTokenRows } from "../server/records/backfill-tokens";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  console.log("[Search] Rows without tokens:", await missingSearchTokenRows());
  const started = Date.now();
  const result = await backfillSearchTokens({ batchSize: 2000 });
  console.log("[Search] Filled:", result);
  console.log("[Search] Remaining:", await missingSearchTokenRows());
  console.log(`[Search] Took ${Math.round((Date.now() - started) / 1000)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
