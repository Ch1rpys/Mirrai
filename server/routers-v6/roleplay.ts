/**
 * The role swap (C4.4).
 *
 * Fifteen minutes, thirty turns, once a day — all enforced here, not in
 * the page. The transcript is the only thing written; no message,
 * memory, mood, intimacy or chat count comes out of it.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { copy } from "@shared/copy";
import { normalizeStyleProfile } from "@shared/style-profile";
import { zonedDateKey, zonedDayStart } from "@shared/timezone";
import {
  candidateRecordsByOverlap,
  countRecords,
  countRoleplaySessionsSince,
  createJournalEntry,
  createRoleplaySession,
  getPersonaById,
  getPersonaStyleProfile,
  getRoleplaySession,
  updateRoleplaySession,
} from "../db";
import {
  ROLEPLAY_MAX_TURNS,
  ROLEPLAY_MIN_USER_LINES,
  ROLEPLAY_MAX_MINUTES,
  buildSelfPrompt,
  remainingMs,
  type RoleplayTurn,
} from "../chat/roleplay";
import { detectCrisis } from "../safety/crisis";
import { llmService } from "../llm";
import { resolveProviderForUser } from "../llm/user-provider";

function turnsOf(value: unknown): RoleplayTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (row.role !== "user" && row.role !== "assistant") return [];
    if (typeof row.content !== "string") return [];
    return [{
      role: row.role,
      content: row.content,
      at: typeof row.at === "string" ? row.at : new Date().toISOString(),
    }];
  });
}

export const roleplayRouter = router({
  start: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

      const lines = await countRecords(input.personaId, ctx.user.id, {
        role: "user",
        kinds: ["text"],
      });
      if (lines < ROLEPLAY_MIN_USER_LINES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "roleplay.tooFewLines"),
        });
      }

      const now = new Date();
      const since = zonedDayStart(now, ctx.user.timezone);
      if ((await countRoleplaySessionsSince(ctx.user.id, since)) >= 1) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: copy(ctx.locale, "roleplay.todayUsed"),
        });
      }

      const id = await createRoleplaySession({
        userId: ctx.user.id,
        personaId: input.personaId,
        startedAt: now,
      });
      if (!id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return {
        sessionId: id,
        remainingSeconds: ROLEPLAY_MAX_MINUTES * 60,
        remainingTurns: ROLEPLAY_MAX_TURNS,
      };
    }),

  say: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      text: z.string().trim().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await getRoleplaySession(input.sessionId, ctx.user.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      if (session.endedAt) return { ended: true as const };

      const now = new Date();
      const remaining = remainingMs(session.startedAt, now);
      // The limits are checked before anything is generated, so the
      // thirty-first turn does not cost a model call.
      if (remaining <= 0 || session.turns >= ROLEPLAY_MAX_TURNS) {
        await updateRoleplaySession(session.id, ctx.user.id, { endedAt: now });
        return { ended: true as const };
      }

      if (detectCrisis(input.text).crisis) {
        await updateRoleplaySession(session.id, ctx.user.id, { endedAt: now });
        return { ended: true as const, crisis: true };
      }

      const persona = await getPersonaById(session.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const stored = await getPersonaStyleProfile(session.personaId, ctx.user.id);
      const profile = normalizeStyleProfile(stored);
      const candidates = await candidateRecordsByOverlap(session.personaId, ctx.user.id, {
        text: input.text,
        role: "user",
        limit: 60,
      });
      const examples = candidates.slice(0, 6).map((row) => row.content);
      const transcript = turnsOf(session.transcript);
      const system = buildSelfPrompt({
        personaName: persona.name,
        locale: ctx.locale,
        userSide: profile.userSide ?? null,
        examples,
      });

      const provider = await resolveProviderForUser({ userId: ctx.user.id });
      if (!provider) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }
      const reply = await llmService.invokeWithProvider(provider, {
        messages: [
          { role: "system" as const, content: system },
          ...transcript.map((turn) => ({
            role: turn.role,
            content: turn.content,
          })),
          { role: "user" as const, content: input.text },
        ],
        options: { temperature: 0.7, maxTokens: 300, purpose: "reply" as const },
      });
      const text = String(reply ?? "").trim();

      const nextTranscript: RoleplayTurn[] = [
        ...transcript,
        { role: "user", content: input.text, at: now.toISOString() },
        { role: "assistant", content: text, at: new Date().toISOString() },
      ];
      const turns = session.turns + 1;
      const nextRemaining = remainingMs(session.startedAt, new Date());
      await updateRoleplaySession(session.id, ctx.user.id, {
        turns,
        transcript: nextTranscript,
        ...(turns >= ROLEPLAY_MAX_TURNS || nextRemaining <= 0
          ? { endedAt: new Date() }
          : {}),
      });

      return {
        ended: turns >= ROLEPLAY_MAX_TURNS || nextRemaining <= 0,
        reply: text,
        turns,
        remainingSeconds: Math.floor(nextRemaining / 1000),
      };
    }),

  end: protectedProcedure
    .input(z.object({ sessionId: z.number(), note: z.string().max(20_000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const session = await getRoleplaySession(input.sessionId, ctx.user.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      await updateRoleplaySession(session.id, ctx.user.id, {
        endedAt: session.endedAt ?? new Date(),
      });
      let journalId: number | undefined;
      const note = input.note?.trim();
      if (note) {
        journalId = await createJournalEntry({
          userId: ctx.user.id,
          personaId: session.personaId,
          body: note,
          entryDate: zonedDateKey(new Date(), ctx.user.timezone),
        });
      }
      return { success: true, journalId };
    }),
});

export default roleplayRouter;
