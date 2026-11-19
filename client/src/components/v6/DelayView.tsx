import { useLocale } from "@/contexts/LocaleContext";
import { DELAY_BANDS, normalizeReplyDelay, type DelayBucket } from "@shared/reply-delay";
import { formatMinuteOfDay, normalizeRoutine } from "@shared/routine-profile";

/**
 * How long they usually take to answer, one row per part of the day.
 *
 * The median is exp(mu): half the measured gaps were shorter.
 */
export default function DelayView({
  name,
  replyDelay,
}: {
  name: string;
  replyDelay?: unknown;
}) {
  const { t } = useLocale();
  const profile = normalizeReplyDelay(replyDelay);
  if (!profile) return null;

  const bandLabel = {
    night: t("profile.delayNight"),
    morning: t("profile.delayMorning"),
    afternoon: t("profile.delayAfternoon"),
    evening: t("profile.delayEvening"),
  } as const;

  function medianLabel(bucket: DelayBucket | undefined): string | null {
    if (!bucket || bucket.n === 0) return null;
    const seconds = Math.exp(bucket.mu);
    if (seconds >= 60) {
      return t("profile.delayMinutes", { n: Math.round(seconds / 60) });
    }
    return t("profile.delaySeconds", { n: Math.round(seconds) });
  }

  return (
    <section className="space-y-3">
      <h2 className="section-title">{t("profile.delayTitle", { name })}</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("profile.delayNote")}</p>
      <ul className="space-y-1.5 text-sm leading-relaxed">
        {DELAY_BANDS.map((band) => {
          const bucket = profile.buckets[band];
          const median = medianLabel(bucket);
          const label = bandLabel[band];
          return (
            <li key={band}>
              {median
                ? t("profile.delayRow", { band: label, median, n: bucket?.n ?? 0 })
                : t("profile.delayEmpty", { band: label })}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SleepWindow({ name, routine }: { name: string; routine?: unknown }) {
  const { t } = useLocale();
  const profile = normalizeRoutine(routine);
  if (!profile?.sleep) return null;
  return (
    <p className="text-sm leading-relaxed mt-3">
      {t("profile.sleepOffline", {
        name,
        start: formatMinuteOfDay(profile.sleep.startMin),
        end: formatMinuteOfDay(profile.sleep.endMin),
      })}
    </p>
  );
}
