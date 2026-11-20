/**
 * What a family member may do with a shared persona (C7.2).
 *
 * A member may talk to it, write to it, read its profile and listen to
 * its recordings. The identity, the records and the rules are the
 * owner's: a member cannot edit the persona, re-distil it, import or
 * delete records, or read the record itself.
 *
 * The check is one function so the routes cannot drift apart on it.
 */
import { TRPCError } from "@trpc/server";
import { copy } from "@shared/copy";

export function assertPersonaWritable(
  persona: { sharedFromPersonaId?: number | null },
  locale: "zh" | "en" = "zh",
): void {
  if (persona?.sharedFromPersonaId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: copy(locale, "errors.sharedReadOnly"),
    });
  }
}
