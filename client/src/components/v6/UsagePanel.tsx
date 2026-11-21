import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { translate, type TranslationKey } from "@/i18n";
import { formatDateTimeInZone } from "@/lib/dates";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * What the model calls cost (C8.9).
 *
 * The app spends money on every reply and had no way to show it. This
 * panel is the ledger's face: this month's tokens and money, what each
 * purpose took, what the four-way choice added, what the last
 * distillation cost, and the ceiling the user sets for themselves.
 *
 * Prices are not built in. A provider changes its prices, and a table
 * shipped with the app would be wrong eventually — so the user fills in
 * what they pay, and until they do the panel shows tokens only. An
 * estimated token count is marked as one.
 */

/** The purpose names, as dictionary keys. */
const PURPOSE_LABELS: Record<string, TranslationKey> = {
  reply: "usage.purpose.reply",
  plan: "usage.purpose.plan",
  rerank: "usage.purpose.rerank",
  classify: "usage.purpose.classify",
  extract: "usage.purpose.extract",
  summarize: "usage.purpose.summarize",
  distill: "usage.purpose.distill",
  letter: "usage.purpose.letter",
  eval: "usage.purpose.eval",
  other: "usage.purpose.other",
};

const RANGES = [
  { value: "month" as const, label: "usage.rangeMonth" as TranslationKey },
  { value: "week" as const, label: "usage.rangeWeek" as TranslationKey },
  { value: "all" as const, label: "usage.rangeAll" as TranslationKey },
];

export default function UsagePanel() {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const timezone = (user as { timezone?: string | null } | null)?.timezone ?? null;
  const utils = trpc.useUtils();
  const [range, setRange] = useState<"month" | "week" | "all">("month");
  const summary = trpc.usage.summary.useQuery({ range });
  const configs = trpc.llmConfig.list.useQuery();

  const [budgetTokens, setBudgetTokens] = useState("");
  const [budgetCost, setBudgetCost] = useState("");
  const [provider, setProvider] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [currency, setCurrency] = useState("CNY");

  const data = summary.data;
  useEffect(() => {
    if (!data) return;
    setBudgetTokens(data.budget.budget?.monthlyTokens != null ? String(data.budget.budget.monthlyTokens) : "");
    setBudgetCost(data.budget.budget?.monthlyCost != null ? String(data.budget.budget.monthlyCost) : "");
  }, [data]);

  useEffect(() => {
    if (!provider && configs.data && configs.data.length > 0) {
      setProvider(configs.data[0]!.providerName);
    }
  }, [configs.data, provider]);

  useEffect(() => {
    const known = data?.prices.find((row) => row.provider === provider);
    if (!known) return;
    setInputPrice(String(known.price.inputPerMTok));
    setOutputPrice(String(known.price.outputPerMTok));
    setCurrency(known.price.currency);
  }, [data, provider]);

  const invalidate = () => {
    utils.usage.summary.invalidate();
    utils.usage.budget.invalidate();
  };
  const saveBudget = trpc.usage.setBudget.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("usage.budgetSaved"));
    },
    onError: (error) => toast.error(error.message),
  });
  const savePrice = trpc.usage.setPrice.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("usage.priceSaved"));
    },
    onError: (error) => toast.error(error.message),
  });

  const currencyOf = data?.currency ?? null;
  const money = (micros: number | null | undefined): string | null => {
    if (micros == null || !currencyOf) return null;
    return `${(micros / 1_000_000).toFixed(2)} ${currencyOf}`;
  };
  const dateOf = (value: string | null | undefined): string =>
    value ? formatDateTimeInZone(value, locale, timezone) : "";

  if (summary.isLoading) {
    return (
      <section className="surface p-5 sm:p-6">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </section>
    );
  }

  if (summary.isError) {
    return (
      <section className="surface p-5 sm:p-6 space-y-2">
        <p className="text-sm text-muted-foreground">{t("usage.failed")}</p>
        <button
          type="button"
          onClick={() => summary.refetch()}
          className="text-sm underline underline-offset-2"
        >
          {t("common.retry")}
        </button>
      </section>
    );
  }

  const totals = data?.totals ?? {
    calls: 0, promptTokens: 0, completionTokens: 0, estimatedCalls: 0, costMicros: 0,
  };
  const tokens = totals.promptTokens + totals.completionTokens;
  const totalMoney = money(totals.costMicros);
  const maxPurposeTokens = Math.max(
    1,
    ...(data?.byPurpose ?? []).map((row) => row.promptTokens + row.completionTokens),
  );

  return (
    <section className="surface p-5 sm:p-6 space-y-5" aria-label={t("usage.title")}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-title">{t("usage.title")}</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-prose">{t("usage.note")}</p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={range === option.value ? "default" : "outline"}
              className="rounded-md"
              onClick={() => setRange(option.value)}
            >
              {String(t(option.label))}
            </Button>
          ))}
        </div>
      </div>

      {data?.budget.over && (
        <p className="text-sm rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          {t("usage.overBudget")}
        </p>
      )}

      <div className="space-y-1">
        <p className="text-sm text-foreground font-medium">
          {t("usage.totalTitle")}
          <span className="ml-3 text-muted-foreground font-normal">
            {t("usage.calls", { n: totals.calls })} · {t("usage.tokens", { n: tokens })}
            {totals.estimatedCalls > 0 && (
              <span className="ml-1 text-[0.6875rem]">（{totals.estimatedCalls} {t("usage.estimated")}）</span>
            )}
          </span>
        </p>
        {totalMoney ? (
          <p className="text-sm text-foreground">{totalMoney}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("usage.noPrice")}</p>
        )}
      </div>

      {totals.calls === 0 ? (
        <p className="text-xs text-muted-foreground">{t("usage.noData")}</p>
      ) : (
        <div className="space-y-2">
          <p className="kicker">{t("usage.byPurpose")}</p>
          <ul className="space-y-2">
            {(data?.byPurpose ?? [])
              .slice()
              .sort((a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens))
              .map((row) => {
                const rowTokens = row.promptTokens + row.completionTokens;
                const rowMoney = money(row.costMicros);
                return (
                  <li key={row.purpose} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-foreground">
                        {String(t(PURPOSE_LABELS[row.purpose] ?? "usage.purpose.other"))}
                        {row.estimatedCalls > 0 && (
                          <span className="ml-1 text-muted-subtle">{t("usage.estimated")}</span>
                        )}
                      </span>
                      <span className="text-muted-foreground">
                        {t("usage.calls", { n: row.calls })} · {t("usage.tokens", { n: rowTokens })}
                        {rowMoney ? ` · ${rowMoney}` : ""}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="progress-bar h-full"
                        style={{ width: `${Math.min(100, (rowTokens / maxPurposeTokens) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {data && data.rerank.calls > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="text-foreground">{t("usage.rerankTitle")}</span>
          <span className="ml-2">
            {money(data.rerank.costMicros)
              ? t("usage.rerankLine", {
                  calls: data.rerank.calls,
                  cost: money(data.rerank.costMicros) ?? "",
                })
              : t("usage.rerankTokens", { n: data.rerank.calls })}
          </span>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        <span className="text-foreground">{t("usage.lastDistill")}</span>
        <span className="ml-2">
          {data?.lastDistill
            ? money(data.lastDistill.costMicros) ?? t("usage.lastDistillNoPrice", {
                date: dateOf(data.lastDistill.at),
                tokens: data.lastDistill.promptTokens + data.lastDistill.completionTokens,
              })
            : t("usage.lastDistillNone")}
          {data?.lastDistill && money(data.lastDistill.costMicros) && (
            <span className="ml-1">
              {t("usage.lastDistillLine", {
                date: dateOf(data.lastDistill.at),
                tokens: data.lastDistill.promptTokens + data.lastDistill.completionTokens,
              })}
            </span>
          )}
        </span>
      </div>

      {/* The ceiling */}
      <div className="space-y-2 border-t border-border/60 pt-4">
        <p className="kicker">{t("usage.budgetTitle")}</p>
        <p className="text-xs text-muted-foreground max-w-prose">{t("usage.budgetNote")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">{t("usage.budgetTokens")}</span>
            <input
              aria-label={t("usage.budgetTokens")}
              className="w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              inputMode="numeric"
              value={budgetTokens}
              onChange={(event) => setBudgetTokens(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="block text-muted-foreground">{t("usage.budgetCost")}</span>
            <input
              aria-label={t("usage.budgetCost")}
              className="w-36 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              inputMode="decimal"
              value={budgetCost}
              onChange={(event) => setBudgetCost(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            className="rounded-md"
            disabled={saveBudget.isPending}
            onClick={() => saveBudget.mutate({
              monthlyTokens: budgetTokens.trim() ? Number(budgetTokens) : null,
              monthlyCost: budgetCost.trim() ? Number(budgetCost) : null,
            })}
          >
            {saveBudget.isPending ? t("common.saving") : t("usage.budgetSave")}
          </Button>
        </div>
      </div>

      {/* The prices */}
      <div className="space-y-2 border-t border-border/60 pt-4">
        <p className="kicker">{t("usage.priceTitle")}</p>
        <p className="text-xs text-muted-foreground max-w-prose">{t("usage.priceNote")}</p>
        {configs.data && configs.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("usage.priceEmpty")}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("usage.priceProvider")}</span>
              <select
                aria-label={t("usage.priceProvider")}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              >
                {(configs.data ?? []).map((config) => (
                  <option key={config.id} value={config.providerName}>{config.providerName}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("usage.priceInput")}</span>
              <input
                aria-label={t("usage.priceInput")}
                className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                inputMode="decimal"
                value={inputPrice}
                onChange={(event) => setInputPrice(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("usage.priceOutput")}</span>
              <input
                aria-label={t("usage.priceOutput")}
                className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                inputMode="decimal"
                value={outputPrice}
                onChange={(event) => setOutputPrice(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("usage.priceCurrency")}</span>
              <input
                aria-label={t("usage.priceCurrency")}
                className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              className="rounded-md"
              disabled={savePrice.isPending || !provider}
              onClick={() => savePrice.mutate({
                provider,
                inputPerMTok: Number(inputPrice || 0),
                outputPerMTok: Number(outputPrice || 0),
                currency: currency.trim() || "CNY",
              })}
            >
              {savePrice.isPending ? t("common.saving") : t("usage.priceSave")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

// Re-exported for tests that build labels without rendering the panel.
export { PURPOSE_LABELS };
export function usagePurposeLabelOf(purpose: string, locale: "zh" | "en"): string {
  return String(translate(locale, PURPOSE_LABELS[purpose] ?? "usage.purpose.other"));
}
