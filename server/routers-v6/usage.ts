/**
 * What the model calls cost (C8.9).
 *
 * The app spends money on every reply and had no way to say what it
 * spent it on. This route group reads the ledger the service writes
 * (`llm_usage`): by purpose, by persona, by day; the price the user
 * filled in for each provider; and the monthly ceiling they set.
 *
 * The price is not built in — prices change, and a built-in one would be
 * wrong eventually. A user who has not filled one in sees token counts
 * and no money.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getLlmConfigsByUserId,
  getPersonasByUserId,
  latestLlmUsageForPurpose,
  setUserBudget,
  sumLlmUsageByDay,
  sumLlmUsageByPersona,
  sumLlmUsageByPurpose,
  sumLlmUsageForJob,
  upsertLlmConfig,
} from "../db";
import { budgetStateForUser, monthStartInstant, normalizeBudget } from "../llm/budget";
import { normalizeUsagePrice, type UsagePrice } from "../llm/usage";

const RANGES = ["month", "week", "all"] as const;

/** Where a range starts, in the user's own zone. */
function rangeStart(range: (typeof RANGES)[number], now: Date, timeZone: string | null): Date {
  if (range === "month") return monthStartInstant(now, timeZone);
  if (range === "week") return new Date(now.getTime() - 7 * 86_400_000);
  return new Date(0);
}

type PriceRow = { provider: string; price: UsagePrice };

/** The price the user filled in for each of their configured providers. */
async function configuredPrices(userId: number): Promise<PriceRow[]> {
  const configs = await getLlmConfigsByUserId(userId);
  const rows: PriceRow[] = [];
  for (const config of configs) {
    const extra = config.extraConfig as { price?: unknown } | null | undefined;
    const price = normalizeUsagePrice(extra?.price);
    if (price) rows.push({ provider: config.providerName, price });
  }
  return rows;
}

/** One currency only when every price agrees; mixed prices cannot add up. */
function currencyOf(prices: PriceRow[]): string | null {
  const currencies = new Set(prices.map((row) => row.price.currency));
  return currencies.size === 1 ? [...currencies][0]! : null;
}

export const usageRouter = router({
  /**
   * The month (or week, or everything) at a glance.
   *
   * The chat page asks for `usage.budget` only; this is the settings
   * panel's query.
   */
  summary: protectedProcedure
    .input(z.object({ range: z.enum(RANGES).default("month") }))
    .query(async ({ ctx, input }) => {
      const timezone = ctx.user.timezone ?? null;
      const now = new Date();
      const from = rangeStart(input.range, now, timezone);
      const [byPurpose, byPersonaRaw, byDay, budget, prices, personas, lastDistillRow] =
        await Promise.all([
          sumLlmUsageByPurpose(ctx.user.id, from),
          sumLlmUsageByPersona(ctx.user.id, from),
          sumLlmUsageByDay(ctx.user.id, from, timezone),
          budgetStateForUser(ctx.user.id, timezone, now),
          configuredPrices(ctx.user.id),
          getPersonasByUserId(ctx.user.id),
          latestLlmUsageForPurpose(ctx.user.id, "distill"),
        ]);

      const names = new Map(personas.map((persona) => [persona.id, persona.name]));
      const byPersona = byPersonaRaw.map((row) => ({
        ...row,
        name: row.personaId == null ? null : (names.get(row.personaId) ?? null),
      }));
      const totals = {
        calls: byPurpose.reduce((sum, row) => sum + row.calls, 0),
        promptTokens: byPurpose.reduce((sum, row) => sum + row.promptTokens, 0),
        completionTokens: byPurpose.reduce((sum, row) => sum + row.completionTokens, 0),
        estimatedCalls: byPurpose.reduce((sum, row) => sum + row.estimatedCalls, 0),
        costMicros: byPurpose.reduce((sum, row) => sum + row.costMicros, 0),
      };
      const rerank = byPurpose.find((row) => row.purpose === "rerank");
      return {
        range: input.range,
        from: from.toISOString(),
        to: now.toISOString(),
        totals,
        byPurpose,
        byPersona,
        byDay,
        budget,
        prices,
        currency: currencyOf(prices),
        rerank: {
          calls: rerank?.calls ?? 0,
          estimatedCalls: rerank?.estimatedCalls ?? 0,
          costMicros: rerank?.costMicros ?? 0,
          /**
           * The tokens the four candidates used. The panel showed the
           * *call count* under the word "tokens" when no price was set;
           * the real total was already in `byPurpose` and was never
           * passed along.
           */
          promptTokens: rerank?.promptTokens ?? 0,
          completionTokens: rerank?.completionTokens ?? 0,
        },
        lastDistill: lastDistillRow
          ? {
              at: lastDistillRow.createdAt.toISOString(),
              promptTokens: lastDistillRow.promptTokens,
              completionTokens: lastDistillRow.completionTokens,
              costMicros: lastDistillRow.costMicros ?? null,
              estimated: lastDistillRow.estimated,
            }
          : null,
      };
    }),

  /** What one distillation or evaluation job spent. */
  job: protectedProcedure
    .input(z.object({ jobId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => sumLlmUsageForJob(ctx.user.id, input.jobId)),

  /** Whether the month's ceiling is reached — what the chat page asks. */
  budget: protectedProcedure.query(async ({ ctx }) =>
    budgetStateForUser(ctx.user.id, ctx.user.timezone ?? null),
  ),

  /**
   * Sets the monthly ceiling.
   *
   * Both limits are optional and independent: a user can cap tokens, or
   * money, or both. Sending `null` for both removes the ceiling.
   */
  setBudget: protectedProcedure
    .input(z.object({
      monthlyTokens: z.number().int().positive().max(1_000_000_000_000).nullable().optional(),
      monthlyCost: z.number().positive().max(1_000_000_000).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const current = normalizeBudget(
        (await budgetStateForUser(ctx.user.id, ctx.user.timezone ?? null)).budget,
      );
      const next = normalizeBudget({
        monthlyTokens:
          input.monthlyTokens === undefined
            ? current?.monthlyTokens
            : input.monthlyTokens,
        monthlyCost:
          input.monthlyCost === undefined ? current?.monthlyCost : input.monthlyCost,
      });
      await setUserBudget(ctx.user.id, next);
      return {
        budget: next,
        state: await budgetStateForUser(ctx.user.id, ctx.user.timezone ?? null),
      };
    }),

  /**
   * Stores the price of one provider.
   *
   * The price lives in `llm_configs.extraConfig.price`, next to the
   * provider's other settings, so it is remembered per provider — a user
   * with two keys does not have to type the same numbers twice.
   */
  setPrice: protectedProcedure
    .input(z.object({
      provider: z.string().min(1).max(64),
      inputPerMTok: z.number().nonnegative().max(1_000_000).finite(),
      outputPerMTok: z.number().nonnegative().max(1_000_000).finite(),
      currency: z.string().trim().min(1).max(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const configs = await getLlmConfigsByUserId(ctx.user.id);
      const wanted = input.provider.toLowerCase();
      const config = configs.find(
        (row) => String(row.providerName ?? "").toLowerCase() === wanted,
      );
      if (!config) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.priceNeedsProvider"),
        });
      }
      const price: UsagePrice = {
        inputPerMTok: input.inputPerMTok,
        outputPerMTok: input.outputPerMTok,
        currency: input.currency,
      };
      const extra =
        config.extraConfig && typeof config.extraConfig === "object"
          ? { ...(config.extraConfig as Record<string, unknown>) }
          : {};
      await upsertLlmConfig(ctx.user.id, {
        providerName: config.providerName,
        extraConfig: { ...extra, price } as never,
      });
      return { success: true, provider: config.providerName, price };
    }),
});

export default usageRouter;
