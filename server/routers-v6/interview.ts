/**
 * The interview for a person with no records (C1.8).
 *
 * The routes are stateless: the client holds the transcript, and the
 * server decides from it which aspect is asked next and when the
 * interview is over. That is deliberate — the aspect is a rule, not a
 * model's whim, and a rule does not need a session table to survive a
 * page reload.
 *
 * Finishing does three things in one call: the transcript becomes one
 * `oral_accounts` row (C7.4's table; who told it, when it was finished),
 * the persona is generated from the submitted accounts with every
 * sentence checked against their words, and the persona is written.
 *
 * The same generation path serves a persona that already exists but has
 * no records and only oral accounts (`fromOral`, C7.4 step 5): the family's
 * accounts are the transcript, and each described sentence names the
 * person who told it.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import type { OralAccountForExtraction } from "@shared/oral";
import { checkFileExtension, sanitizeFileName } from "../_core/filename";
import { withPersonaDataLock } from "../_core/lock";
import { RATE_LIMITS } from "../_core/rate-limit";
import { transcribeAudio } from "../_core/stt";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { normalizePersonaData } from "../_core/persona-schema";
import {
  ORAL_ACCOUNT_MAX_CHARS,
  countRecords,
  createOralAccount,
  createPersona,
  getPersonaById,
  listSubmittedOralAccounts,
  updatePersona,
} from "../db";
import { resolveProviderForPurposeWithOwnership, resolveProviderForUser } from "../llm/user-provider";
import type { LLMMessage } from "../llm/types";
import {
  INTERVIEW_ASPECTS,
  INTERVIEW_MAX_ROUNDS,
  interviewTranscriptText,
  nextQuestion,
  type InterviewAspect,
  type InterviewTurn,
} from "../templates/interview";
import { describedPersonaData } from "../templates/described";
import type { Locale } from "@shared/copy";

/** A voice answer is capped at the same size as a chat voice note. */
const MAX_INTERVIEW_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_INTERVIEW_AUDIO_CHARS = Math.ceil(MAX_INTERVIEW_AUDIO_BYTES / 3) * 4;

/** The most turns one interview can carry: the twenty asked, plus margin. */
const MAX_INTERVIEW_TURNS = INTERVIEW_MAX_ROUNDS + 4;

const interviewTurnSchema = z.object({
  aspect: z.enum(INTERVIEW_ASPECTS),
  question: z.string().max(1000),
  answer: z.string().max(4000),
});

const transcriptSchema = z
  .array(interviewTurnSchema)
  .min(1)
  .max(MAX_INTERVIEW_TURNS);

/** The name the account is signed with. */
function tellerNameFor(user: { name?: string | null; username: string }): string {
  const name = String(user.name ?? "").trim() || user.username;
  return name.slice(0, 64);
}

/**
 * A model call for one purpose, or null when the user has no provider.
 *
 * The caller decides what "no model" means: the interview goes on with
 * its own questions, but a persona cannot be written from descriptions
 * without one.
 */
async function invokerFor(params: {
  userId: number;
  purpose: "other" | "distill";
  personaProvider?: string | null;
}): Promise<((messages: LLMMessage[]) => Promise<string | null>) | null> {
  const resolved = await resolveProviderForPurposeWithOwnership({
    userId: params.userId,
    purpose: params.purpose,
    personaProvider: params.personaProvider ?? undefined,
  });
  const provider = resolved.provider;
  if (!provider) return null;
  return async (messages: LLMMessage[]) => {
    try {
      const text = await provider.invoke(messages, { purpose: params.purpose });
      return typeof text === "string" && text.trim() ? text : null;
    } catch {
      return null;
    }
  };
}

/** The accounts a persona's described sentences are checked against. */
function accountsOf(
  rows: Array<{ id: number; tellerName: string; body: string }>,
): OralAccountForExtraction[] {
  return rows.map((row) => ({
    id: row.id,
    tellerName: row.tellerName,
    body: row.body,
  }));
}

/** A persona that is not there, or not the caller's, is the same answer. */
async function ownedPersona(personaId: number, userId: number) {
  const persona = await getPersonaById(personaId, userId);
  if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
  return persona;
}

/**
 * Refuses a persona that already has chat records.
 *
 * A persona with records is measured, and this path is for the person
 * whose records do not exist: running it over one would overwrite what
 * the records taught the persona with sentences about it.
 */
async function assertNoRecords(persona: { id: number }, userId: number, locale: Locale) {
  const records = await countRecords(persona.id, userId);
  if (records > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: copy(locale, "errors.describedHasRecords"),
    });
  }
}

/**
 * Writes the generated description onto the persona.
 *
 * The read and the write are under the persona's lock, and the merge is
 * done against the *current* data — so a correction typed while the
 * model was writing is not thrown away by it.
 */
async function writeDescribedPersona(params: {
  personaId: number;
  userId: number;
  name: string;
  locale: Locale;
  fields: Record<string, unknown>;
  described: unknown;
}): Promise<void> {
  await withPersonaDataLock(params.personaId, async () => {
    const persona = await getPersonaById(params.personaId, params.userId);
    if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
    const current =
      persona.personaData && typeof persona.personaData === "object" && !Array.isArray(persona.personaData)
        ? (persona.personaData as Record<string, unknown>)
        : {};
    const next = normalizePersonaData(
      { ...current, ...params.fields, described: params.described },
      { name: persona.name || params.name, locale: params.locale },
    );
    const written = await updatePersona(params.personaId, params.userId, {
      personaData: next as never,
    });
    if (!written) throw new TRPCError({ code: "NOT_FOUND" });
  });
}

export const interviewRouter = router({
  /**
   * The next question.
   *
   * The aspect is decided from the transcript, in the fixed order; the
   * model only phrases the question. Without a provider the interviewer
   * asks its own question for that aspect.
   */
  next: protectedProcedure
    .use(rateLimit(RATE_LIMITS.llm))
    .input(
      z.object({
        transcript: z.array(interviewTurnSchema).max(MAX_INTERVIEW_TURNS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const invoke = await invokerFor({ userId: ctx.user.id, purpose: "other" });
      return nextQuestion({
        transcript: input.transcript as InterviewTurn[],
        locale: ctx.locale,
        invoke: invoke ?? undefined,
      });
    }),

  /**
   * A spoken answer, turned into words for the person to read.
   *
   * Nothing is stored here: the words go into the box the person can
   * edit, and only what they send is kept.
   */
  transcribe: protectedProcedure
    .use(rateLimit(RATE_LIMITS.chatMedia))
    .input(
      z.object({
        audioContent: z.string().min(1).max(MAX_INTERVIEW_AUDIO_CHARS),
        fileName: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.audioContent, "base64");
      if (buffer.length > MAX_INTERVIEW_AUDIO_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.fileTooLarge"),
        });
      }
      const safeName = sanitizeFileName(input.fileName);
      const extensionProblem = checkFileExtension(safeName, "audio", ctx.locale);
      if (extensionProblem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: extensionProblem });
      }
      if (buffer.length === 0) return { text: "" };
      /**
       * The user's own voice provider, as the oral accounts and the chat
       * use. Without it, a provider-engine install would transcribe
       * nothing and the recording would be silently ignored.
       */
      const voiceProvider = await resolveProviderForUser({ userId: ctx.user.id });
      const heard = await transcribeAudio({
        buffer,
        fileName: safeName,
        purpose: "chat",
        provider: voiceProvider ?? undefined,
      });
      return { text: heard?.text ?? "" };
    }),

  /**
   * Ends the interview: stores it, and writes the persona from it.
   *
   * With `personaId` the interview is the answer to a persona that
   * already exists (nobody uploaded anything for it); without it the
   * answers create a new one.
   */
  finish: protectedProcedure
    .use(rateLimit(RATE_LIMITS.llmHeavy))
    .input(
      z.object({
        transcript: transcriptSchema,
        /** A new persona's name. Required when there is no `personaId`. */
        name: z.string().trim().min(1).max(100).optional(),
        /** An existing persona with no records, described by interview. */
        personaId: z.number().optional(),
        relationshipDesc: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const locale = ctx.locale;
      const transcript = input.transcript as InterviewTurn[];
      const body = interviewTranscriptText(transcript, locale);
      if (!body.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(locale, "errors.interviewEmpty") });
      }
      if (body.length > ORAL_ACCOUNT_MAX_CHARS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(locale, "errors.oralTooLong") });
      }
      const tellerName = tellerNameFor(ctx.user);
      const submittedAt = new Date();

      if (typeof input.personaId === "number") {
        const persona = await ownedPersona(input.personaId, ctx.user.id);
        if (persona.sharedFromPersonaId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: copy(locale, "errors.oralOwnerOnly"),
          });
        }
        await assertNoRecords(persona, ctx.user.id, locale);
        const accountId = await createOralAccount({
          personaId: persona.id,
          userId: ctx.user.id,
          tellerName,
          body,
          submittedAt,
        });
        /**
         * The account just written is part of the material even before
         * the list read reflects it (a database read in the same tick
         * may not). The family's earlier accounts join it.
         */
        const stored = await listSubmittedOralAccounts(persona.id, ctx.user.id);
        const accounts = [
          { id: accountId, tellerName, body },
          ...stored.filter((row) => row.id !== accountId),
        ];
        const invoke = await invokerFor({
          userId: ctx.user.id,
          purpose: "distill",
          personaProvider: persona.llmProvider ?? undefined,
        });
        if (!invoke) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(locale, "errors.noProviderConfigured"),
          });
        }
        const generated = await describedPersonaData({
          accounts: accountsOf(accounts),
          name: persona.name,
          locale,
          base:
            persona.personaData && typeof persona.personaData === "object"
              ? (persona.personaData as Record<string, unknown>)
              : {},
          invoke,
        });
        if (!generated.readable || generated.statements.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(locale, "errors.interviewUnreadable"),
          });
        }
        await writeDescribedPersona({
          personaId: persona.id,
          userId: ctx.user.id,
          name: persona.name,
          locale,
          fields: generated.fields as Record<string, unknown>,
          described: generated.statements,
        });
        return {
          personaId: persona.id,
          accountId,
          statements: generated.statements.length,
          dropped: generated.dropped,
        };
      }

      const name = input.name?.trim();
      if (!name) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(locale, "errors.interviewNameRequired"),
        });
      }
      const accounts: OralAccountForExtraction[] = [
        { id: 0, tellerName, body },
      ];
      const invoke = await invokerFor({ userId: ctx.user.id, purpose: "distill" });
      if (!invoke) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(locale, "errors.noProviderConfigured"),
        });
      }
      const generated = await describedPersonaData({
        accounts,
        name,
        locale,
        invoke,
      });
      if (!generated.readable || generated.statements.length === 0 || !generated.personaData) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(locale, "errors.interviewUnreadable"),
        });
      }
      const personaId = await createPersona({
        userId: ctx.user.id,
        name,
        relationshipDesc: input.relationshipDesc?.trim() || null,
        togetherFrom: null,
        togetherTo: null,
        personaData: generated.personaData as never,
        source: "described",
        analysisStatus: "ready",
        analysisProgress: 100,
        analysisMessage: copy(locale, "persona.fromInterview"),
      });
      const accountId = await createOralAccount({
        personaId,
        userId: ctx.user.id,
        tellerName,
        body,
        submittedAt,
      });
      return {
        personaId,
        accountId,
        statements: generated.statements.length,
        dropped: generated.dropped,
      };
    }),

  /**
   * Writes the persona from the oral accounts already submitted (C7.4).
   *
   * The family's accounts are the transcript; every described sentence
   * carries the teller's name and their words. Only the owner can do
   * this, and only while the persona has no chat records.
   */
  fromOral: protectedProcedure
    .use(rateLimit(RATE_LIMITS.llmHeavy))
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const locale = ctx.locale;
      const persona = await ownedPersona(input.personaId, ctx.user.id);
      if (persona.sharedFromPersonaId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: copy(locale, "errors.oralOwnerOnly"),
        });
      }
      await assertNoRecords(persona, ctx.user.id, locale);
      const accounts = await listSubmittedOralAccounts(persona.id, ctx.user.id);
      if (accounts.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(locale, "errors.describedNoAccounts", { name: persona.name }),
        });
      }
      const invoke = await invokerFor({
        userId: ctx.user.id,
        purpose: "distill",
        personaProvider: persona.llmProvider ?? undefined,
      });
      if (!invoke) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(locale, "errors.noProviderConfigured"),
        });
      }
      const generated = await describedPersonaData({
        accounts: accountsOf(accounts),
        name: persona.name,
        locale,
        base:
          persona.personaData && typeof persona.personaData === "object"
            ? (persona.personaData as Record<string, unknown>)
            : {},
        invoke,
      });
      if (!generated.readable || generated.statements.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(locale, "errors.interviewUnreadable"),
        });
      }
      await writeDescribedPersona({
        personaId: persona.id,
        userId: ctx.user.id,
        name: persona.name,
        locale,
        fields: generated.fields as Record<string, unknown>,
        described: generated.statements,
      });
      return {
        personaId: persona.id,
        statements: generated.statements.length,
        dropped: generated.dropped,
        tellers: [...new Set(generated.statements.map((row) => row.teller).filter(Boolean))],
      };
    }),
});

export default interviewRouter;
