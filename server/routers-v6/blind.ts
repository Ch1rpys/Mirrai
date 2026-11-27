/**
 * The in-app blind test.
 *
 * A sitting shows two lines and asks which one they wrote. The groups
 * keep the truth; the payload that leaves the server does not, until
 * the sitting is finished. A friend arrives with a token, not an account.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy, type Locale } from "@shared/copy";
import { FEEDBACK_REASONS } from "@shared/speech-acts";
import { protectedProcedure, publicProcedure, router, rateLimit } from "../_core/trpc";
import { RATE_LIMITS } from "../_core/rate-limit";
import {
  createBlindSession,
  getBlindSession,
  getBlindSessionByTokenHash,
  getEvalCases,
  getLatestEvalRun,
  getPersonaById,
  listBlindSessions,
  updateBlindSession,
  updateBlindSessionByTokenHash,
} from "../db";
import {
  arrangeBlindGroups,
  asAnswers,
  asStoredGroups,
  BLIND_DEFAULT_GROUPS,
  createBlindToken,
  expectedMessageIdsFromCases,
  exportBlindRecord,
  hashBlindToken,
  pickBlindGroups,
  publicBlindGroups,
  revealBlindGroups,
  summariseBlindSitting,
  type BlindAnswer,
  type BlindPick,
  type BlindStoredGroup,
  type BlindSubject,
} from "../eval/blind";

const pickSchema = z.enum(["first", "second", "unsure"]);
const reasonSchema = z.enum(FEEDBACK_REASONS).optional();
const subjectSchema = z.enum(["self", "friend"]);

function scoresOf(metrics: unknown): Array<{
  caseId: number;
  expectedText?: string;
  generatedText?: string;
}> {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return [];
  const scores = (metrics as { scores?: unknown }).scores;
  if (!Array.isArray(scores)) return [];
  return scores.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.caseId !== "number") return [];
    return [
      {
        caseId: row.caseId,
        expectedText: typeof row.expectedText === "string" ? row.expectedText : undefined,
        generatedText: typeof row.generatedText === "string" ? row.generatedText : undefined,
      },
    ];
  });
}

function occurredAtMap(
  rows: Array<{ occurredAt?: Date | string | null }>,
): Map<number, Date | string | null> {
  const out = new Map<number, Date | string | null>();
  rows.forEach((row, index) => out.set(index, row.occurredAt ?? null));
  return out;
}

function upsertAnswer(answers: BlindAnswer[], next: BlindAnswer): BlindAnswer[] {
  const without = answers.filter((answer) => answer.group !== next.group);
  return [...without, next].sort((a, b) => a.group - b.group);
}

function finishIfComplete(
  groups: BlindStoredGroup[],
  answers: BlindAnswer[],
): { summary: ReturnType<typeof summariseBlindSitting>; finishedAt: Date } | null {
  if (answers.length < groups.length) return null;
  if (![...Array(groups.length).keys()].every((index) => answers.some((answer) => answer.group === index))) {
    return null;
  }
  return { summary: summariseBlindSitting(groups, answers), finishedAt: new Date() };
}

function publicSitting(groups: BlindStoredGroup[], name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    total: groups.length,
    groups: publicBlindGroups(groups),
    ...extra,
  };
}

function throwIfGuestClosed(
  session: { expiresAt?: Date | string | null; finishedAt?: Date | string | null } | undefined,
): asserts session is NonNullable<typeof session> {
  const expired = Boolean(
    session?.expiresAt && new Date(session.expiresAt).getTime() < Date.now(),
  );
  if (!session || session.finishedAt || expired) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

/**
 * The pairs for a new sitting, out of the latest evaluation run.
 *
 * Both the owner's own sitting and the fresh guest sitting an invite
 * creates are cut the same way. Each pair keeps the id of the record
 * its expected answer came from, so a reason given later points at the
 * line it is about rather than at a position in a list.
 */
async function pickSittingGroups(params: {
  personaId: number;
  userId: number;
  subject: BlindSubject;
  groups: number;
  locale: Locale;
  seed: string;
}): Promise<BlindStoredGroup[]> {
  const run = await getLatestEvalRun(params.personaId, params.userId);
  const cases = await getEvalCases(params.personaId, params.userId);
  const messageIds = expectedMessageIdsFromCases(cases);
  const picked = pickBlindGroups(scoresOf(run?.metricsJson), {
    groups: params.groups,
    subject: params.subject,
    occurredAt: occurredAtMap(cases),
    seed: `${params.seed}:${run?.id ?? 0}`,
  });
  if (picked.length < params.groups) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: copy(params.locale, "eval.blind.needEval"),
    });
  }
  return picked.map((group) => ({ ...group, messageId: messageIds.get(group.caseId) }));
}

export const blindRouter = router({
  start: protectedProcedure
    .input(
      z.object({
        personaId: z.number(),
        subject: subjectSchema,
        groups: z.number().int().min(1).max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const wanted = input.groups ?? BLIND_DEFAULT_GROUPS;
      const picked = await pickSittingGroups({
        personaId: input.personaId,
        userId: ctx.user.id,
        subject: input.subject,
        groups: wanted,
        locale: ctx.locale,
        seed: `blind-pick:${input.personaId}`,
      });
      const created = await createBlindSession({
        userId: ctx.user.id,
        personaId: input.personaId,
        subject: input.subject,
        groups: [],
        answers: [],
      });
      const arranged = arrangeBlindGroups(picked, created.id);
      await updateBlindSession(created.id, ctx.user.id, { groups: arranged });
      return {
        sessionId: created.id,
        subject: input.subject,
        ...publicSitting(arranged, persona.name),
      };
    }),

  answer: protectedProcedure
    .input(
      z.object({
        sessionId: z.number(),
        group: z.number().int().min(0),
        pick: pickSchema,
        seconds: z.number().min(0),
        reason: reasonSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await getBlindSession(input.sessionId, ctx.user.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      if (session.finishedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "eval.blind.finished") });
      }
      const groups = asStoredGroups(session.groups);
      if (input.group >= groups.length) throw new TRPCError({ code: "BAD_REQUEST" });
      const answers = upsertAnswer(asAnswers(session.answers), {
        group: input.group,
        pick: input.pick as BlindPick,
        seconds: input.seconds,
        reason: input.reason ?? "",
      });
      const done = finishIfComplete(groups, answers);
      const updated = await updateBlindSession(session.id, ctx.user.id, {
        answers,
        summary: done?.summary ?? session.summary,
        finishedAt: done?.finishedAt ?? null,
      });
      return {
        done: Boolean(done),
        summary: done?.summary ?? null,
        reveal: done ? revealBlindGroups(groups, answers) : null,
        total: groups.length,
        answered: asAnswers(updated?.answers ?? answers).length,
      };
    }),

  finish: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await getBlindSession(input.sessionId, ctx.user.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const groups = asStoredGroups(session.groups);
      const answers = asAnswers(session.answers);
      const summary = summariseBlindSitting(groups, answers);
      await updateBlindSession(session.id, ctx.user.id, {
        summary,
        finishedAt: session.finishedAt ?? new Date(),
      });
      return {
        summary,
        reveal: revealBlindGroups(groups, answers),
      };
    }),

  exportRecord: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }) => {
      const session = await getBlindSession(input.sessionId, ctx.user.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const groups = asStoredGroups(session.groups);
      const answers = asAnswers(session.answers);
      const summary = session.summary
        ? (session.summary as ReturnType<typeof summariseBlindSitting>)
        : summariseBlindSitting(groups, answers);
      const markdown = exportBlindRecord(
        {
          personaId: session.personaId,
          subject: session.subject as BlindSubject,
          startedAt: session.startedAt,
          groups,
          answers,
          summary,
        },
        ctx.locale,
      );
      return { markdown };
    }),

  list: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const rows = await listBlindSessions(input.personaId, ctx.user.id);
      const finished = rows.filter((row) => row.finishedAt);
      return {
        sessions: finished.slice(0, 3).map((row) => ({
          id: row.id,
          subject: row.subject,
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
          summary: row.summary,
        })),
      };
    }),

  /**
   * A one-use link for somebody without an account.
   *
   * The link has to point at a sitting a friend can still take. A
   * finished sitting cannot: the guest routes close it on purpose (a
   * sitting is answerable once). So an invite created from a finished
   * sitting — the owner has just done their own test, or a friend has
   * just finished — starts a fresh guest sitting and points at that.
   * An unfinished sitting is handed to the friend as it is.
   */
  invite: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await getBlindSession(input.sessionId, ctx.user.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      const token = createBlindToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tokenHash = hashBlindToken(token);
      let sittingId = session.id;
      if (session.finishedAt) {
        const persona = await getPersonaById(session.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const wanted = Math.min(
          40,
          Math.max(1, asStoredGroups(session.groups).length || BLIND_DEFAULT_GROUPS),
        );
        const picked = await pickSittingGroups({
          personaId: session.personaId,
          userId: ctx.user.id,
          subject: "friend",
          groups: wanted,
          locale: ctx.locale,
          seed: `blind-invite:${session.personaId}:${session.id}`,
        });
        const created = await createBlindSession({
          userId: ctx.user.id,
          personaId: session.personaId,
          subject: "friend",
          groups: [],
          answers: [],
        });
        const arranged = arrangeBlindGroups(picked, created.id);
        await updateBlindSession(created.id, ctx.user.id, {
          groups: arranged,
          tokenHash,
          expiresAt,
        });
        sittingId = created.id;
      } else {
        await updateBlindSession(session.id, ctx.user.id, { tokenHash, expiresAt });
      }
      return {
        token,
        path: `/blind/${token}`,
        expiresAt: expiresAt.toISOString(),
        sessionId: sittingId,
      };
    }),

  guestLoad: publicProcedure
    .use(rateLimit(RATE_LIMITS.auth))
    .input(z.object({ token: z.string().min(16).max(128) }))
    .query(async ({ ctx, input }) => {
      const session = await getBlindSessionByTokenHash(hashBlindToken(input.token));
      throwIfGuestClosed(session);
      const persona = await getPersonaById(session.personaId, session.userId);
      const groups = asStoredGroups(session.groups);
      return publicSitting(groups, persona?.name ?? "");
    }),

  guestAnswer: publicProcedure
    .use(rateLimit(RATE_LIMITS.auth))
    .input(
      z.object({
        token: z.string().min(16).max(128),
        group: z.number().int().min(0),
        pick: pickSchema,
        seconds: z.number().min(0),
        reason: reasonSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenHash = hashBlindToken(input.token);
      const session = await getBlindSessionByTokenHash(tokenHash);
      throwIfGuestClosed(session);
      const groups = asStoredGroups(session.groups);
      if (input.group >= groups.length) throw new TRPCError({ code: "BAD_REQUEST" });
      const answers = upsertAnswer(asAnswers(session.answers), {
        group: input.group,
        pick: input.pick as BlindPick,
        seconds: input.seconds,
        reason: input.reason ?? "",
      });
      const done = finishIfComplete(groups, answers);
      await updateBlindSessionByTokenHash(tokenHash, {
        answers,
        summary: done?.summary ?? session.summary,
        finishedAt: done?.finishedAt ?? null,
      });
      return {
        done: Boolean(done),
        summary: done?.summary ?? null,
        reveal: done ? revealBlindGroups(groups, answers) : null,
        total: groups.length,
        answered: answers.length,
      };
    }),
});

export { listBlindSessions };
