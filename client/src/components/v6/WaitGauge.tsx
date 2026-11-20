import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import {
  DELAY_BANDS,
  DELAY_BUCKET_MIN,
  bandOf,
  delayQuantiles,
  normalizeReplyDelay,
  type DelayBucket,
} from "@shared/reply-delay";

/**
 * How long they usually take to answer, at this hour (C3.1).
 *
 * It is a reading of the past, not a timer. There is no countdown, no
 * "you have been waiting", no reminder if the reply does not come — the
 * component has no clock in it at all. Waiting is the user's own time;
 * the app's job is only to say what the record says.
 *
 * The numbers are the measured log-normal's median and ninetieth
 * percentile: half of the old replies came within the first, nine in ten
 * within the second.
 */
export default function WaitGauge({
  personaId,
  name,
  timezone,
  now,
}: {
  personaId: number;
  name: string;
  timezone?: string | null;
  /** Fixed in tests; the real page uses the clock. */
  now?: Date;
}) {
  const { t } = useLocale();
  const { data, isLoading, isError, refetch } = trpc.style.get.useQuery({ personaId });
  const profile = normalizeReplyDelay(data?.profile?.replyDelay);

  function duration(seconds: number): string {
    if (seconds >= 60) {
      return t("waitGauge.minutes", { n: Math.round(seconds / 60) });
    }
    return t("waitGauge.seconds", { n: Math.round(seconds) });
  }

  const band = profile ? bandOf(now ?? new Date(), timezone || "Asia/Shanghai") : null;
  const current = band && profile ? profile.buckets[band] : undefined;

  const bandLabel = {
    night: t("profile.delayNight"),
    morning: t("profile.delayMorning"),
    afternoon: t("profile.delayAfternoon"),
    evening: t("profile.delayEvening"),
  } as const;

  return (
    <section className="space-y-3" aria-label={t("waitGauge.title", { name })}>
      <h2 className="section-title">{t("waitGauge.title", { name })}</h2>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : isError ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{t("common.error")}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : !profile ? (
        <p className="text-xs text-muted-foreground">{t("waitGauge.empty")}</p>
      ) : (
        <>
          {current && current.n >= DELAY_BUCKET_MIN ? (
            <p className="text-sm leading-relaxed">
              {t("waitGauge.summary", {
                name,
                median: duration(delayQuantiles(current).medianSec),
                p90: duration(delayQuantiles(current).p90Sec),
              })}
            </p>
          ) : null}
          <table className="w-full text-xs">
            <tbody>
              {DELAY_BANDS.map((rowBand) => {
                const bucket: DelayBucket | undefined = profile.buckets[rowBand];
                const enough = Boolean(bucket && bucket.n >= DELAY_BUCKET_MIN);
                return (
                  <tr key={rowBand} className="border-b border-border/40 last:border-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">
                      {bandLabel[rowBand]}
                    </th>
                    {enough && bucket ? (
                      <>
                        <td className="py-1.5 pr-3 text-foreground/85">
                          {t("waitGauge.medianCell", {
                            value: duration(delayQuantiles(bucket).medianSec),
                          })}
                        </td>
                        <td className="py-1.5 pr-3 text-foreground/85">
                          {t("waitGauge.p90Cell", {
                            value: duration(delayQuantiles(bucket).p90Sec),
                          })}
                        </td>
                        <td className="py-1.5 text-muted-subtle">
                          {t("waitGauge.samplesCell", { n: bucket.n })}
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className="py-1.5 text-muted-subtle">
                        {t("waitGauge.insufficient")}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-subtle leading-relaxed">{t("waitGauge.note")}</p>
        </>
      )}
    </section>
  );
}
