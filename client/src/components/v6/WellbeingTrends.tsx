import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";

/**
 * The wellbeing trend (C4.3).
 *
 * Four series, eight weeks, and one sentence each comparing the recent
 * four weeks with the four before. The app states what it counted. It
 * does not grade it, does not score it, and does not draw a progress
 * bar — there is no "good" direction to a mood.
 */
function Spark({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 28 - (value / max) * 24;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 28"
      role="img"
      aria-label={label}
      className="w-full h-10 text-foreground/60"
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function WellbeingTrends() {
  const { t } = useLocale();
  const { data, isLoading, isError, refetch } = trpc.analytics.wellbeing.get.useQuery();

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (isError) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground">{t("common.error")}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (!data) return null;

  const { weeks, recent, previous } = data;
  const cards = [
    {
      key: "moods",
      label: t("wellbeing.moodsLabel"),
      values: weeks.map((week: any) => week.moods),
      line: t("wellbeing.moodsLine", { a: recent.moods, b: previous.moods }),
    },
    {
      key: "checkins",
      label: t("wellbeing.checkinsLabel"),
      values: weeks.map((week: any) => week.checkins.better + week.checkins.worse),
      line: t("wellbeing.checkinsLine", {
        better: recent.checkins.better,
        same: recent.checkins.same,
        worse: recent.checkins.worse,
        previousBetter: previous.checkins.better,
        previousSame: previous.checkins.same,
        previousWorse: previous.checkins.worse,
      }),
    },
    {
      key: "visits",
      label: t("wellbeing.visitsLabel"),
      values: weeks.map((week: any) => week.visits),
      line: t("wellbeing.visitsLine", { a: recent.visits, b: previous.visits }),
    },
    {
      key: "late",
      label: t("wellbeing.lateLabel"),
      values: weeks.map((week: any) => week.lateNight),
      line: t("wellbeing.lateLine", {
        a: recent.lateNight,
        b: previous.lateNight,
        total: recent.messages,
        previousTotal: previous.messages,
      }),
    },
  ];

  return (
    <section className="space-y-3">
      <h2 className="section-title">{t("wellbeing.title")}</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("wellbeing.note")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map((card) => (
          <div key={card.key} className="rounded-xl border border-border/70 p-3 space-y-1">
            <p className="text-[11px] text-muted-subtle">{card.label}</p>
            <Spark values={card.values} label={card.label} />
            <p className="text-xs leading-relaxed text-foreground/85">{card.line}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
