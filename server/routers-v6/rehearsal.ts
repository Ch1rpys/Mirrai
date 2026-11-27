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
import { budgetExceeded } from "../llm/budget";
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
import type { Locale } from "@shared/copy";

/** The daily cap, in the user's own calendar. */
export const REHEARSAL_DAILY_LIMIT = 20;

/**
 * The same two guards in the phrasings the shared table does not list.
 *
 * `shared/rehearsal.ts` is the canonical table, built from the manual's
 * own examples. The acceptance review found that questions asking the
 * same thing in other words still went to "three possibilities" — the
 * room then put a whole model back-and-forth in front of the user for a
 * question it must refuse without calling a model at all. The retry
 * guard had the same gap: a second line that made the promise in other
 * words got through.
 *
 * Both lists are deliberately conservative: every pattern asks what the
 * *other person* would promise, decide, agree to, or commit to, which is
 * the answer the replica cannot give. Ordinary questions ("你今天忙吗")
 * are not caught.
 */
// i18n:allow-input — matched against what the user typed
const THEIR_ANSWER_QUESTION_PATTERNS: RegExp[] = [
  // 你会答应我吗 / 你愿意答应下来吗、同意和好吗
  /你(会|愿意|肯)(不会|不愿意|不肯)?(答应我|答应(下来)?|同意(和好|复合|再试|原谅|重新开始)|同意我)/,
  // 你会原谅我吗 / 你愿意回来吗 / 你决定原谅我了吗
  /你(会|愿意|打算|决定|能|可以)(不会|不愿意|不打算)?(原谅我|回来|复合|和好|再试|重新开始)/,
  // 会不会 / 愿不愿意 / 能不能 … （A-not-A 问句）
  /你(会不会|愿不愿意|肯不肯|能不能|可不可以|打不打算)(原谅|答应|同意|接受|回来|复合|和好|再试|重新开始|给我们|给我)/,
  // 我们还能重新开始吗 / 咱们会不会在一起
  /(我们|咱们)(还能|能不能|会不会|可不可以|可以|要不要)(重新开始|重新在一起|和好|复合|在一起)/,
  // 我们会和好吗 / 能重新开始吗
  /(和好|复合|重新开始|重新在一起)(吗|么|呢|？|\?)/,
  // 你会给我一次机会吗 / 能不能再给我一次机会
  /(会|能|可以|愿意|肯)(再)?给(我|我们)(一|另)?次机会/,
  // 你依然爱我吗 / 你还喜欢我吗（共享词表只覆盖「还爱…吗」这一种）
  /(你|你依然|你仍然|你一直)(还|依然|仍然|一直)?(爱|喜欢|在乎)(着)?我(吗|么|呢|？|\?)/,
  // 要不要和好 / 我们要不要重新开始
  /要不要(和好|复合|重新开始|再试一次|重新在一起)/,
  // 原谅我吗
  /原谅我(吗|么|呢|？|\?)/,
  // will/would you …; would you give me another chance
  /(will|would|can|could|do) you (still )?(forgive|agree|promise|stay|come back|take me back|try again|give me)/i,
  // can we start over / will we get back together
  /(will|would|can|could|should) we (start over|try again|get back together|be together)/i,
  // are you going to forgive me; do you want to get back together
  /(are you (going to|gonna)|do you (want|plan|intend) to) (forgive|come back|stay|try|agree|promise|get back together|start over)/i,
  // will you stay / wait for me / say yes
  /will you (stay|wait for me|say yes)/i,
  // do you still care about me
  /do you (still )?care about me/i,
  // would you give me another chance (and the like)
  /(would|will) you give (me|us) (another |a second |one more )?chance/i,
];

// i18n:allow-input — matched against what the model wrote
const ANSWERS_FOR_THEM_PATTERNS: RegExp[] = [
  // 我会原谅你 / 我决定原谅你 / 我愿意再试一次
  /(我|我们)(会|决定|打算|愿意|可以|能)(原谅|答应|同意|接受|回来|复合|和好|再试|重新开始)/,
  // 我们重新开始吧 / 咱们再在一起吧
  /(我们|咱们)(重新|再)(开始|在一起|试试|来过)/,
  // 我会等你 / 我会一直陪着你
  /(我|我们)(会|愿意)(一直)?(等你|陪着你|陪在你身边|一直在)/,
  // 我不恨你了
  /我(已经)?不恨你/,
  // 我给你一次机会 / 再给你一次机会
  /(再)?给你(一|另)?次机会/,
  // 我同意和好 / 我决定分手
  /我(决定|同意)(和好|复合|分开|分手|做朋友|当朋友)/,
  // 我们分开吧 / 我们还是做朋友吧
  /(我们|咱们)(还是)?(分开|分手|做朋友|当朋友)(吧)?/,
  // 我依然爱你 / 我还是爱你
  /我(依然|仍然|一直|还是)爱你/,
  // 我们在一起吧
  /我们(重新|还是)?在一起吧/,
  // I'll forgive you / I've decided to forgive you
  /i('ll| will| have decided to|'ve decided to| decided to|'m going to| am going to) (forgive|come back|stay|try again|give you|agree|accept)/i,
  // I'm willing to try again
  /i('m| am) willing to (forgive|try|come back)/i,
  // I'll give you another chance
  /i('ll| will) give you (another |a second |one more )?chance/i,
  // we can start over / let's try again
  /(we (can|will|should) |let'?s )(start over|try again|be together|get back together|be friends)/i,
  // I'll wait for you
  /i('ll| will) wait for you/i,
  // I still have feelings for you
  /i still (have feelings for you|care about you)/i,
  // I'm not angry anymore
  /i('m| am) not (angry|mad|upset) anymore/i,
];

/** The shared question table plus the phrasings it does not list. */
export function asksForTheirAnswer(line: string): boolean {
  const value = String(line ?? "").trim();
  if (!value) return false;
  return (
    isCommitmentQuestion(value) ||
    THEIR_ANSWER_QUESTION_PATTERNS.some((pattern) => pattern.test(value))
  );
}

/** The shared reply table plus the phrasings it does not list. */
export function answersForThem(reply: string): boolean {
  const value = String(reply ?? "").trim();
  if (!value) return false;
  return (
    containsCommitment(value) ||
    ANSWERS_FOR_THEM_PATTERNS.some((pattern) => pattern.test(value))
  );
}

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
       * A crisis is answered before anything that could turn the room
       * off (C8.9): it needs no model, so neither the budget, the
       * user's step-down, nor the daily limit may swallow it.
       */
      if (detectCrisis(input.line).crisis) {
        return { mode: "crisis" as const };
      }
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
            : chat.reason === "consent"
              ? "chat.closedConsent"
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

      if (await budgetExceeded(ctx.user.id, ctx.user.timezone ?? null)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.budgetOver") });
      }

      if (asksForTheirAnswer(input.line)) {
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
  locale: Locale;
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
  /**
   * Both gates use the widened tables (C3.2).
   *
   * The first gate already stopped the manual's examples; the review
   * found that the same promise in other words passed, and then the
   * retry could pass it again — the user saw the replica decide for the
   * real person.
   */
  if (!answersForThem(first)) return first || null;
  const second = await generate(params.regenerateInstruction);
  if (!second || answersForThem(second)) return null;
  return second;
}

export default rehearsalRouter;
