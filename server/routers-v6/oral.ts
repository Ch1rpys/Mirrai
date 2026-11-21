/**
 * What people remember about the person (C7.4).
 *
 * The owner — and any family member who was let in through C7.2 — can
 * write, or say, a passage about the person. A draft is the teller's
 * alone; submitting it is what makes it readable by the persona's owner,
 * and the interface says so before the button is pressed.
 *
 * Only the owner can turn the submitted accounts into memories, and the
 * extraction is the same shape as the rest of the app's mining: the
 * statements land in `memories` unverified evidence-free only in the
 * sense that they came from a person, not a model — the quote they are
 * built on is checked against the account itself.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { normalizeOralKey } from "@shared/oral";
import { checkFileExtension, sanitizeFileName } from "../_core/filename";
import { RATE_LIMITS } from "../_core/rate-limit";
import { resolveProviderForUser } from "../llm/user-provider";
import { transcribeAudio } from "../_core/stt";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import {
  ORAL_ACCOUNT_MAX_CHARS,
  createOralAccount,
  getOralMemories,
  getPersonaById,
  getUserById,
  listOralAccounts,
  listSubmittedOralAccounts,
  updateOralAccount,
} from "../db";
import { extractOralMemories } from "../oral/extract";
import type { Locale } from "@shared/copy";

/**
 * A voice passage is capped at the same size as a chat voice note.
 *
 * The audio is transcribed and not stored: an oral account is the words,
 * and keeping the recording would be a second copy of somebody's voice
 * that nothing in this feature needs.
 */
const MAX_ORAL_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_ORAL_AUDIO_CHARS = Math.ceil(MAX_ORAL_AUDIO_BYTES / 3) * 4;

/** The owner's persona row: a member's accounts meet on that one. */
function ownerPersonaId(persona: { id: number; sharedFromPersonaId?: number | null }): number {
  return persona.sharedFromPersonaId ?? persona.id;
}

/**
 * A stopped share is not a place to keep writing.
 *
 * `getPersonaById` returns the member's own row even after the share is
 * revoked — without the owner's identity on it. Writing there would put
 * words onto somebody's persona that they no longer share, so the row
 * that has a `sharedFromPersonaId` and no hydrated owner is refused.
 */
function assertShareAlive(
  persona: { sharedFromPersonaId?: number | null; sharedFromUserId?: number | null },
  locale: Locale,
): void {
  if (persona.sharedFromPersonaId && !persona.sharedFromUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: copy(locale, "chat.revoked") });
  }
}

/** The name the account is signed with. */
function tellerNameFor(user: { name?: string | null; username: string }): string {
  const name = String(user.name ?? "").trim() || user.username;
  return name.slice(0, 64);
}

/**
 * The keys two tellers disagree on, as stored right now.
 *
 * It reads the memories rather than this run's statements: a
 * disagreement found last week is still one today.
 */
function conflictGroups(
  rows: Array<{ id: number; factKey: string | null; title: string; description: string | null; status: string }>,
) {
  const byKey = new Map<string, Array<{ id: number; title: string; description: string | null }>>();
  for (const row of rows) {
    if (row.status === "superseded") continue;
    const key = normalizeOralKey(row.factKey);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push({ id: row.id, title: row.title, description: row.description });
    byKey.set(key, list);
  }
  return [...byKey.entries()]
    .filter(([, list]) => new Set(list.map((item) => item.title.toLowerCase())).size > 1)
    .map(([key, items]) => ({ key, items }));
}

export const oralRouter = router({
  /**
   * The accounts this caller may read.
   *
   * The caller's own always; the family's only for the owner — and only
   * the submitted ones. The conflicts are the owner's business, so a
   * member gets an empty list.
   */
  list: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      assertShareAlive(persona, ctx.locale);
      const isOwner = !persona.sharedFromPersonaId;
      const accounts = await listOralAccounts(ownerPersonaId(persona), ctx.user.id);
      /**
       * The owner's name, for the note a family member reads before
       * submitting. It is the same name the invitation showed them.
       */
      const hydrated = persona as typeof persona & { sharedFromUserId?: number | null };
      const owner = !isOwner && hydrated.sharedFromUserId
        ? await getUserById(hydrated.sharedFromUserId)
        : null;
      let conflicts: ReturnType<typeof conflictGroups> = [];
      if (isOwner) {
        const memories = await getOralMemories(persona.id, ctx.user.id);
        conflicts = conflictGroups(
          memories.map((row) => ({
            id: row.id,
            factKey: row.factKey,
            title: row.title,
            description: row.description,
            status: row.status,
          })),
        );
      }
      return {
        isOwner,
        ownerName: String(owner?.name ?? "").trim(),
        accounts: accounts.map((row) => ({
          id: row.id,
          tellerName: row.tellerName,
          body: row.body,
          submitted: row.submittedAt !== null,
          mine: row.userId === ctx.user.id,
          createdAt: row.createdAt.toISOString(),
        })),
        conflicts,
      };
    }),

  /**
   * Saves a draft, or submits one.
   *
   * The body is the teller's own words, and it is limited here rather
   * than by the column: a text column has no length, so a pasted book
   * would be accepted and then shown to the owner.
   */
  save: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      /** The account being edited; absent for a new one. */
      id: z.number().optional(),
      body: z.string(),
      submit: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      assertShareAlive(persona, ctx.locale);

      const body = String(input.body ?? "").trim();
      if (!body) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.oralEmpty") });
      }
      if (body.length > ORAL_ACCOUNT_MAX_CHARS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.oralTooLong") });
      }

      const personaId = ownerPersonaId(persona);
      const submittedAt = input.submit ? new Date() : undefined;

      if (typeof input.id === "number") {
        const row = await updateOralAccount(input.id, ctx.user.id, personaId, {
          body,
          ...(submittedAt ? { submittedAt } : {}),
        });
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: copy(ctx.locale, "errors.oralNotYours"),
          });
        }
        return { id: row.id, submitted: row.submittedAt !== null };
      }

      const id = await createOralAccount({
        personaId,
        userId: ctx.user.id,
        tellerName: tellerNameFor(ctx.user),
        body,
        submittedAt: submittedAt ?? null,
      });
      return { id, submitted: Boolean(submittedAt) };
    }),

  /**
   * Turns a recording into the text the teller then reads and edits.
   *
   * Nothing is stored here: the words go into the form, and only what
   * the teller saves is kept. An empty answer is said honestly — the
   * caller shows "could not hear that" instead of inventing words.
   */
  transcribe: protectedProcedure
    .use(rateLimit(RATE_LIMITS.chatMedia))
    .input(z.object({
      personaId: z.number(),
      audioContent: z.string().min(1).max(MAX_ORAL_AUDIO_CHARS),
      fileName: z.string().min(1).max(255),
    }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      assertShareAlive(persona, ctx.locale);

      const buffer = Buffer.from(input.audioContent, "base64");
      if (buffer.length > MAX_ORAL_AUDIO_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.fileTooLarge") });
      }
      const safeName = sanitizeFileName(input.fileName);
      const extensionProblem = checkFileExtension(safeName, "audio", ctx.locale);
      if (extensionProblem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: extensionProblem });
      }
      if (buffer.length === 0) return { text: "" };

      const providerName = (persona as { llmProvider?: string | null }).llmProvider || undefined;
      const voiceProvider = await resolveProviderForUser({
        userId: ctx.user.id,
        providerName,
      });
      const heard = await transcribeAudio({
        buffer,
        fileName: safeName,
        purpose: "chat",
        provider: voiceProvider ?? undefined,
      });
      return { text: heard?.text ?? "" };
    }),

  /**
   * The owner turns the submitted accounts into memories.
   *
   * Statements without a quote that is literally in an account are
   * dropped; the same claim is not stored twice; two tellers who
   * disagree stay side by side until the owner picks one in the
   * existing memory conflict panel.
   */
  extract: protectedProcedure
    .use(rateLimit(RATE_LIMITS.llm))
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      if (persona.sharedFromPersonaId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: copy(ctx.locale, "errors.oralOwnerOnly"),
        });
      }
      const accounts = await listSubmittedOralAccounts(persona.id, ctx.user.id);
      return extractOralMemories({
        persona,
        userId: ctx.user.id,
        accounts: accounts.map((row) => ({
          id: row.id,
          tellerName: row.tellerName,
          body: row.body,
        })),
        locale: ctx.locale,
      });
    }),
});

export default oralRouter;
