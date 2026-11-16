/**
 * Turning uploaded files into records.
 *
 * A1 only adds `backfill`. C1.1 fills in status, preview, confirm, and
 * cancel on this same router.
 */
import { readFile } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isUnparsedChatUpload } from "@shared/records";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { RATE_LIMITS } from "../_core/rate-limit";
import { getFilesByPersonaId, getPersonaById } from "../db";
import { startImport } from "../importers";
import { resolveStoredPath } from "../storage";

export const importRouter = router({
  /**
   * Walks the persona's old chat uploads into the record table.
   *
   * It is not run on upgrade: a file from before the import path
   * existed may need the user to say who is who. The upload page
   * shows a banner; this is the button.
   */
  backfill: protectedProcedure
    .use(rateLimit(RATE_LIMITS.upload))
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

      const files = await getFilesByPersonaId(input.personaId, ctx.user.id);
      const pending = files.filter(isUnparsedChatUpload);
      const results: Array<{ fileId: number; status: string; written: number }> = [];

      for (const file of pending) {
        let bytes: Uint8Array | undefined;
        const diskPath = resolveStoredPath(file.fileKey);
        if (diskPath) {
          try {
            bytes = await readFile(diskPath);
          } catch {
            bytes = undefined;
          }
        }
        const result = await startImport({
          fileId: file.id,
          userId: ctx.user.id,
          bytes,
          locale: ctx.locale,
        });
        results.push({ fileId: file.id, status: result.status, written: result.written });
      }

      return { count: pending.length, results };
    }),
});
