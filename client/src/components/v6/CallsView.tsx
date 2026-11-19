import { useLocale } from "@/contexts/LocaleContext";
import { copy } from "@shared/copy";
import { normalizeCallStats } from "@shared/call-stats";

/**
 * How they use the phone.
 *
 * Four statements, all counted from the records: who called whom, how
 * long they talked, when they picked up, and how often it happened.
 * Nothing here is a judgement about the relationship.
 */
export default function CallsView({
  name,
  calls,
}: {
  name: string;
  calls?: unknown;
}) {
  const { t, locale } = useLocale();
  const stats = normalizeCallStats(calls);
  if (!stats) return null;

  const slots = stats.answerSlots.slice(0, 3).map((slot) =>
    t("profile.callsSlot", {
      weekday: copy(locale, `labels.routine.weekday.${slot.weekday}` as "labels.routine.weekday.0"),
      hour: slot.hour,
    }),
  );

  return (
    <section className="space-y-3 mt-4">
      <h2 className="section-title">{t("profile.callsTitle", { name })}</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("profile.callsNote")}</p>
      <ul className="space-y-1.5 text-sm leading-relaxed">
        <li>
          {t("profile.callsWho", {
            name,
            incoming: stats.byDirection.in,
            outgoing: stats.byDirection.out,
            missed: stats.byDirection.missed,
          })}
        </li>
        <li>
          {t("profile.callsDuration", {
            median: Math.round(stats.durationSec.median / 60),
            longest: Math.round(stats.longest.durationSec / 60),
          })}
        </li>
        {slots.length > 0 && (
          <li>{t("profile.callsWhen", { slots: slots.join(t("profile.callsJoin")) })}</li>
        )}
      </ul>
    </section>
  );
}
