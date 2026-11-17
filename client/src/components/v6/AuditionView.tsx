import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface AuditionRow {
  id: string;
  providerName: string;
  model: string;
  label: string;
  overlap?: number;
  styleDistance?: number | null;
  residueRate?: number;
  avgChars?: number;
  avgMs?: number;
  composite?: number;
  error?: string;
}

function fmt(value: number | null | undefined, digits = 3): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

/**
 * Tries every model the user has configured, on the same held-out cases.
 *
 * The table is the sitting: highest composite first. Picking a row
 * writes that provider onto the persona.
 */
export default function AuditionView({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const [rows, setRows] = useState<AuditionRow[] | null>(null);
  const info = trpc.eval.auditionInfo.useQuery({ personaId });
  const audition = trpc.eval.audition.useMutation({
    onSuccess: (report) => {
      const sorted = [...(report.results ?? [])].sort(
        (a, b) => (b.composite ?? -Infinity) - (a.composite ?? -Infinity),
      );
      setRows(sorted);
    },
    onError: (error) => toast.error(error.message),
  });
  const update = trpc.persona.update.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const count = info.data?.count ?? 0;
  const cases = info.data?.cases ?? 0;
  const calls = info.data?.calls ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t("fidelity.audition.title")}</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            audition.mutate({
              personaId,
              locale: locale === "en" ? "en" : "zh",
            })
          }
          disabled={audition.isPending || count === 0}
        >
          {audition.isPending ? t("fidelity.audition.running") : t("fidelity.audition.run")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {count === 0
          ? t("fidelity.audition.none")
          : t("fidelity.audition.hint", { count, cases, calls })}
      </p>
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">{t("fidelity.audition.colModel")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("fidelity.audition.colComposite")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("fidelity.audition.colOverlap")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("fidelity.audition.colStyle")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("fidelity.audition.colResidue")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("fidelity.audition.colChars")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("fidelity.audition.colMs")}</th>
                <th className="py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border/60">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{row.label}</td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {row.error ? t("fidelity.audition.failed") : fmt(row.composite)}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmt(row.overlap)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmt(row.styleDistance ?? undefined)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmt(row.residueRate)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmt(row.avgChars, 1)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmt(row.avgMs, 0)}</td>
                  <td className="py-1.5 text-right">
                    {row.error ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          update.mutate({ id: personaId, llmProvider: row.providerName })
                        }
                        disabled={update.isPending}
                      >
                        {t("fidelity.audition.useThis")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
