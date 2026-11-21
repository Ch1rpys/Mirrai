/**
 * The rehearsal room (C3.2).
 *
 * The user says the thing they are afraid to say, and the room shows a
 * few of the ways the record suggests it might land. It is practice:
 * nothing here becomes a chat message, a memory, a mood, a chat count or
 * a reason for the persona to speak first. The only row written is the
 * rehearsal itself, and the only way a sentence leaves the room is the
 * user choosing to keep it for the way-out list.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, rateLimit } from "../_core/trpc";
import { assertPersonaWritable } from "../_core/persona-access";
import { RATE_LIMITS } from "../_core/rate-limit";
import { copy } from "@shared/copy";
import { mayChatNow } from "@shared/persona-state";
import { normalizeActProfile, countsForCondition } from "@shared/act-profile";
import { labelUserActByRule } from "@shared/speech-acts";
import { zonedDayStart } from "@shared/timezone";
import { normalizePersonaSettings } from "@shared/persona-settings";
import {
  containsCommitment,
  isCommitmentQuestion,
  topRehearsalActs,
} from "@shared/rehearsal";
import {
  countRehearsalsSince,
  createOutboundLetter,
  createRehearsal,
  deleteRehearsal,
  getPersonaById,
  getRehearsalById,
  listRehearsals,
  setRehearsalOutboundLetter,
} from "../db";
import { planTurn, executePlan, type TurnInput } from "../chat/generate";
import { retrieveMemories } from "../chat/retrieval";
import { resolveProviderForUser } from "../llm/user-provider";
import { detectCrisis } from "../safety/crisis";

/** The daily cap, in the user's own calendar. */
export const REHEARSAL_DAILY_LIMIT = 20;

export interface RehearsalVariant {
  act: string;
  share: number;
  text: string | null;
  silent: boolean;
}

export const rehearsalRouter = router({
  /**
   * Rehearses one sentence.
   *
   * A question only the person can answer is refused before any model is
   * called: the app does not put words in the person's mouth. A crisis is
   * caught even earlier and goes to the crisis card. Everything else is
   * generated from the record's own act distribution, at most three
   * variants, each with the act it came from.
   */
  run: protectedProcedure
    .use(rateLimit(RATE_LIMITS.llmHeavy))
    .input(z.object({ personaId: z.number(), line: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      assertPersonaWritable(persona, ctx.locale);
      /**
       * The user's own step-down closes the rehearsal room too (C6.1).
       *
       * The room calls the generation path directly, so it never meets
       * `runConversation` and its `ChatClosedError`; it has to ask the
       * same question itself, or "I only write letters now" would still
       * let the user put words in the persona's mouth here.
       */
      const chat = mayChatNow(persona, new Date(), ctx.user.timezone ?? null);
      if (!chat.ok) {
        const key = chat.reason === "weekend_only"
          ? "chat.closedWeekend"
          : chat.reason === "letters_only"
            ? "chat.closedLettersOnly"
            : "chat.closedSealed";
        throw new TRPCError({
          code: "FORBIDDEN",
          message: copy(ctx.locale, key, { name: persona.name }),
        });
      }
      const settings = normalizePersonaSettings(persona.settings);
      if (
        persona.graduationStatus === "graduated" ||
        persona.presence === "asleep" ||
        settings.locked
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: copy(ctx.locale, "rehearsal.unavailable"),
        });
      }

      const now = new Date();
      const since = zonedDayStart(now, ctx.user.timezone);
      if (await countRehearsalsSince(ctx.user.id, since) >= REHEARSAL_DAILY_LIMIT) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: copy(ctx.locale, "rehearsal.dailyLimit"),
        });
      }

      if (detectCrisis(input.line).crisis) {
        return { mode: "crisis" as const };
      }

      if (isCommitmentQuestion(input.line)) {
        const id = await createRehearsal({
          userId: ctx.user.id,
          personaId: input.personaId,
          line: input.line,
          result: { mode: "my_side_only" },
        });
        return { mode: "my_side_only" as const, id };
      }

      const actProfile = normalizeActProfile(
        (persona.personaData as { actProfile?: unknown } | null)?.actProfile,
      );
      const condition = {
        userAct: labelUserActByRule(input.line) ?? "other",
        emotion: persona.emotionalState ?? "warm",
        asking: labelUserActByRule(input.line) === "ask",
        media: false,
        relationshipPhase: (persona.personaData as { relationshipPhase?: string } | null)
          ?.relationshipPhase ?? "initial",
      };
      const counts = actProfile
        ? countsForCondition(actProfile, condition as never).counts
        : null;
      const chosen = topRehearsalActs(counts as Record<string, number> | null);

      const provider = await resolveProviderForUser({ userId: ctx.user.id });
      if (!provider && chosen.some((entry) => entry.act !== "silence")) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: copy(ctx.locale, "rehearsal.noProvider"),
        });
      }

      const memories = await retrieveMemories({
        personaId: input.personaId,
        userId: ctx.user.id,
        userMessage: input.line,
        locale: ctx.locale,
        now: now.getTime(),
      });

      const variants: RehearsalVariant[] = [];
      for (const entry of chosen) {
        if (entry.act === "silence") {
          variants.push({ act: entry.act, share: entry.share, text: null, silent: true });
          continue;
        }
        const text = provider
          ? await generateVariant({
              persona,
              userId: ctx.user.id,
              line: input.line,
              locale: ctx.locale,
              now,
              memories: memories as never,
              forcedAct: entry.act,
              provider,
              seed: `rehearsal:${ctx.user.id}:${input.personaId}:${entry.act}`,
              regenerateInstruction: copy(ctx.locale, "rehearsal.regenerateInstruction"),
            })
          : null;
        variants.push({
          act: entry.act,
          share: entry.share,
          text,
          silent: false,
        });
      }

      const id = await createRehearsal({
        userId: ctx.user.id,
        personaId: input.personaId,
        line: input.line,
        result: { mode: "variants", variants },
      });
      return { mode: "variants" as const, variants, id };
    }),

  /** Keeps the practised line on the way-out list. */
  keep: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const rehearsal = await getRehearsalById(input.id, ctx.user.id);
      if (!rehearsal) throw new TRPCError({ code: "NOT_FOUND" });
      if (rehearsal.outboundLetterId) {
        return { outboundLetterId: rehearsal.outboundLetterId };
      }
      const letterId = await createOutboundLetter({
        userId: ctx.user.id,
        personaId: rehearsal.personaId,
        text: rehearsal.line,
        status: "ready",
      });
      if (!letterId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await setRehearsalOutboundLetter(rehearsal.id, ctx.user.id, letterId);
      return { outboundLetterId: letterId };
    }),

  list: protectedProcedure
    .input(z.object({ personaId: z.number(), limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      assertPersonaWritable(persona, ctx.locale);
      return { rehearsals: await listRehearsals(input.personaId, ctx.user.id, input.limit) };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await deleteRehearsal(input.id, ctx.user.id);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
});

/**
 * One variant, with the commitment guard.
 *
 * If the model promises or decides on the person's behalf, it is asked
 * once more with a firm instruction. A second failure is reported as
 * "could not generate this one" rather than shown — a polite invention is
 * still the app speaking for somebody who is not there.
 */
async function generateVariant(params: {
  persona: NonNullable<Awaited<ReturnType<typeof getPersonaById>>>;
  userId: number;
  line: string;
  locale: "zh" | "en";
  now: Date;
  memories: never;
  forcedAct: string;
  provider: NonNullable<Awaited<ReturnType<typeof resolveProviderForUser>>>;
  seed: string;
  regenerateInstruction: string;
}): Promise<string | null> {
  const generate = async (instruction?: string): Promise<string> => {
    const turnInput: TurnInput = {
      persona: params.persona,
      userId: params.userId,
      userMessage: params.line,
      history: [{ role: "user", content: params.line }],
      now: params.now,
      locale: params.locale,
      memories: params.memories,
      seed: params.seed,
      forcedAct: params.forcedAct as never,
      ...(instruction ? { sceneOverlay: instruction } : {}),
    };
    const plan = await planTurn(turnInput);
    let text = "";
    for await (const event of executePlan(plan, turnInput, {
      provider: params.provider,
      mode: "once",
      rerank: false,
      options: { temperature: 0.8, maxTokens: 300 },
    })) {
      if (event.type === "final") text = event.text || text;
    }
    return text.trim();
  };

  const first = await generate();
  if (!containsCommitment(first)) return first || null;
  const second = await generate(params.regenerateInstruction);
  if (!second || containsCommitment(second)) return null;
  return second;
}

export default rehearsalRouter;
