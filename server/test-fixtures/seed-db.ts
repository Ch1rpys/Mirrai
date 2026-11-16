/**
 * Writes the 小满 fixture into a real database persona.
 *
 * Later entries (A1, eval:fixture) ask for a persona that already has
 * the designed records. The live helpers go through `server/db.ts` so
 * the same lock and idempotency rules apply as a real import.
 */
import { createHash } from "node:crypto";
import { createCollectedMessages, createPersona } from "../db";
import { buildXiaomanRecords, XIAOMAN_NAME } from "./xiaoman";

export async function seedXiaoman(
  _db: unknown,
  options: { userId: number; seed?: string; withHarm?: boolean },
): Promise<{ personaId: number; count: number }> {
  const records = buildXiaomanRecords({ seed: options.seed, withHarm: options.withHarm });
  const personaId = await createPersona({
    userId: options.userId,
    name: XIAOMAN_NAME,
    analysisStatus: "ready",
  });
  const seen = new Map<string, number>();
  const rows = records
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => {
      const base = `generic|${row.timestamp.toISOString()}|${row.content}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const key = n === 0 ? base : `${base}|#${n}`;
      return {
        userId: options.userId,
        personaId,
        source: "generic",
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        idempotencyKey: createHash("md5").update(key).digest("hex"),
      };
    });
  const count = await createCollectedMessages(rows);
  return { personaId, count };
}
