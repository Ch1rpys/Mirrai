import { useLocale } from "@/contexts/LocaleContext";
import {
  fingerprintHighlights,
  type StyleFingerprint,
} from "@shared/style-fingerprint";

/**
 * The handful of fingerprint claims that are worth putting on a page.
 *
 * A class that is rare, or a sample that is thin, is left off.
 */
export default function FingerprintView({
  fingerprint,
}: {
  fingerprint?: StyleFingerprint | null;
}) {
  const { t } = useLocale();
  if (!fingerprint) return null;
  const lines = fingerprintHighlights(fingerprint);
  if (lines.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">{t("fidelity.fingerprint.title")}</h3>
      <ul className="space-y-1.5 text-sm leading-relaxed">
        {lines.map((line) => {
          if (line.id === "almostNoPeriod") {
            return (
              <li key={line.id}>
                {t("fidelity.fingerprint.almostNoPeriod", {
                  rate: ((line.rate ?? 0) * 100).toFixed(1),
                })}
              </li>
            );
          }
          if (line.id === "laughFourHa") {
            return <li key={line.id}>{t("fidelity.fingerprint.laughFourHa")}</li>;
          }
          return (
            <li key={line.id}>
              {t("fidelity.fingerprint.topParticles", {
                list: (line.particles ?? []).join(t("fidelity.fingerprint.particleSep")),
              })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
