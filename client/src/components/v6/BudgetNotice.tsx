import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * The month's ceiling, on the chat page (C8.9).
 *
 * It has to be said where the spending happens: a user who wonders why
 * the four-way choice stopped should not have to go looking in the
 * settings. The server is the one that actually takes the expensive
 * layers out — this is the notice, not the switch.
 */
export default function BudgetNotice() {
  const { t } = useLocale();
  const { data } = trpc.usage.budget.useQuery(undefined, { refetchInterval: false });
  if (!data?.over) return null;
  return (
    <p
      data-testid="budget-notice"
      className="mb-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground leading-relaxed"
    >
      {t("usage.overBudget")}
    </p>
  );
}
