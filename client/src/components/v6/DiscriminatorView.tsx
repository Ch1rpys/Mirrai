import { useLocale } from "@/contexts/LocaleContext";
import type { TranslationKey } from "@/i18n";

export interface DiscriminatorTellView {
  feature: string;
  weight: number;
  side: "persona" | "real";
}

export interface DiscriminatorReportView {
  pairs: number;
  auc: number;
  aucStd?: number;
  tells: DiscriminatorTellView[];
  insufficient?: boolean;
}

const FEATURE_KEYS: Record<string, TranslationKey> = {
  chars: "fidelity.discriminator.feature.chars",
  "ending.period": "fidelity.discriminator.feature.endingPeriod",
  "ending.ellipsis": "fidelity.discriminator.feature.endingEllipsis",
  "ending.question": "fidelity.discriminator.feature.endingQuestion",
  "ending.exclaim": "fidelity.discriminator.feature.endingExclaim",
  "ending.tilde": "fidelity.discriminator.feature.endingTilde",
  "ending.emoji": "fidelity.discriminator.feature.endingEmoji",
  "ending.particle": "fidelity.discriminator.feature.endingParticle",
  "ending.other": "fidelity.discriminator.feature.endingOther",
  particle: "fidelity.discriminator.feature.particle",
  haRun: "fidelity.discriminator.feature.haRun",
  emoji: "fidelity.discriminator.feature.emoji",
  question: "fidelity.discriminator.feature.question",
  exclaim: "fidelity.discriminator.feature.exclaim",
  newline: "fidelity.discriminator.feature.newline",
  list: "fidelity.discriminator.feature.list",
  surprise: "fidelity.discriminator.feature.surprise",
};

/**
 * The AUC and the handful of tells from the last discriminator run.
 *
 * A missing report is a missing panel: this is a measurement, not a
 * claim the persona has not been measured yet.
 */
export default function DiscriminatorView({
  report,
  name,
}: {
  report?: DiscriminatorReportView | null;
  name?: string;
}) {
  const { t } = useLocale();
  if (!report) return null;
  const who = name?.trim() || t("fidelity.discriminator.them");

  if (report.insufficient) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("fidelity.discriminator.insufficient", {
            n: report.pairs,
            need: 60,
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed">
        {t("fidelity.discriminator.summary", {
          pairs: report.pairs,
          auc: report.auc.toFixed(3),
        })}
      </p>
      {report.tells.length > 0 ? (
        <>
          <h3 className="text-sm font-medium">{t("fidelity.discriminator.title")}</h3>
          <table className="w-full text-sm">
            <tbody>
              {report.tells.map((tell) => {
                const key = FEATURE_KEYS[tell.feature];
                const label = key
                  ? String(t(key))
                  : String(t("fidelity.discriminator.feature.gram", { gram: tell.feature }));
                return (
                <tr key={`${tell.feature}:${tell.side}`} className="border-t border-border/60">
                  <td className="py-1.5 pr-3">{label}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                    {tell.side === "persona"
                      ? t("fidelity.discriminator.sidePersona")
                      : t("fidelity.discriminator.sideReal")}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {tell.weight.toFixed(2)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
      <p className="text-[11px] text-muted-subtle leading-relaxed">
        {t("fidelity.discriminator.hint", { name: who })}
      </p>
    </div>
  );
}
