import { Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import type { TranslationKey } from "@/i18n";
import type { MaterialReport as MaterialReportData } from "@shared/material-report";

const LAYER_NAME: Record<string, TranslationKey> = {
  fingerprint: "material.layer.fingerprint",
  acts: "material.layer.acts",
  suppressions: "material.layer.suppressions",
  timing: "material.layer.timing",
  openings: "material.layer.openings",
  periods: "material.layer.periods",
  perState: "material.layer.perState",
  evalCases: "material.layer.evalCases",
  rituals: "material.layer.rituals",
};

const LAYER_HOW: Record<string, TranslationKey> = {
  fingerprint: "material.how.fingerprint",
  acts: "material.how.acts",
  suppressions: "material.how.suppressions",
  timing: "material.how.timing",
  openings: "material.how.openings",
  periods: "material.how.periods",
  perState: "material.how.perState",
  evalCases: "material.how.evalCases",
  rituals: "material.how.rituals",
};

const STATE_LABEL: Record<string, TranslationKey> = {
  warm: "emotions.warm.label",
  playful: "emotions.playful.label",
  nostalgic: "emotions.nostalgic.label",
  melancholy: "emotions.melancholy.label",
  happy: "emotions.happy.label",
  distant: "emotions.distant.label",
};

function stateLabel(
  state: string | undefined,
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (!state) return "";
  const key = STATE_LABEL[state];
  return key ? String(t(key)) : state;
}

/**
 * One row per generation layer: enough, or how far short, and how to fill it.
 */
export function MaterialReportView(props: { report: MaterialReportData }) {
  const { t } = useLocale();
  return (
    <section className="surface p-5 sm:p-6 mb-6 space-y-3">
      <h2 className="section-title">{t("material.title")}</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("material.hint")}</p>
      <ul className="space-y-2">
        {props.report.layers.map((row) => (
          <li key={row.id} data-testid={`material-layer-${row.id}`} className="text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-medium">
                {String(t(LAYER_NAME[row.id] ?? "material.title"))}
              </span>
              {row.ok ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="w-3 h-3" aria-hidden />
                  {t("material.ok", { n: row.have })}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("material.short", { n: Math.max(0, row.need - row.have) })}
                </span>
              )}
            </div>
            {!row.ok ? (
              <p className="text-xs text-muted-subtle mt-0.5">
                {row.id === "perState"
                  ? String(
                      t("material.how.perState", {
                        state: stateLabel(row.weakestState, t),
                        have: row.have,
                      }),
                    )
                  : String(t(LAYER_HOW[row.id] ?? "material.hint"))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The upload page's view of whether the record can carry each layer.
 */
export default function MaterialReport(props: { personaId: number }) {
  const { t } = useLocale();
  const query = trpc.material.report.useQuery(
    { personaId: props.personaId },
    { enabled: props.personaId > 0 },
  );
  if (query.isError) {
    return (
      <p className="text-xs text-destructive mb-6" role="alert">
        {t("common.error")}
      </p>
    );
  }
  if (!query.data) return null;
  return <MaterialReportView report={query.data} />;
}
