import { useState } from "react";
import { useParams } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useDayKey } from "@/lib/day";
import { Button } from "@/components/ui/button";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import TimelineChart from "@/components/v6/TimelineChart";
import FirstsList from "@/components/v6/FirstsList";
import { PlacesPanel, SongsPanel } from "@/components/v6/PlacesSongs";
import { mayFeature } from "@/lib/lobby-eligibility";

/**
 * The relationship's numbers (C2.4).
 *
 * Five tabs, every one of them counted from the record: the yearly
 * numbers, the weekly curves, the firsts and lasts, the places, the
 * songs. Nothing is scored.
 */
type Tab = "annual" | "timeline" | "firsts" | "places" | "songs";

const TABS: Array<{ id: Tab; key: "annual" | "timeline" | "firsts" | "places" | "songs" }> = [
  { id: "annual", key: "annual" },
  { id: "timeline", key: "timeline" },
  { id: "firsts", key: "firsts" },
  { id: "places", key: "places" },
  { id: "songs", key: "songs" },
];

function tabLabels(t: (key: any, params?: any) => string) {
  return {
    annual: t("report.tabs.annual"),
    timeline: t("report.tabs.timeline"),
    firsts: t("report.tabs.firsts"),
    places: t("report.tabs.places"),
    songs: t("report.tabs.songs"),
  } as const;
}

export default function Report() {
  const params = useParams<{ id: string }>();
  const personaId = Number(params.id);
  const { t } = useLocale();
  const day = useDayKey();
  const [tab, setTab] = useState<Tab>("annual");
  const persona = trpc.persona.get.useQuery({ id: personaId }, { enabled: personaId > 0 });
  const report = trpc.record.report.useQuery(
    { personaId },
    {
      enabled: personaId > 0,
      refetchInterval: (query) =>
        (query.state.data as { status?: string } | undefined)?.status === "building" ? 2000 : false,
    },
  );

  if (!Number.isFinite(personaId) || personaId <= 0) return <NotFound />;
  if (persona.isLoading) return <PageLoader />;
  if (!persona.data) return <NotFound />;
  const name = persona.data.name;
  const featured = mayFeature(persona.data as never);
  const labels = tabLabels(t);

  const content = (() => {
    if (report.isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
    if (report.isError) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p>{t("report.failed")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => report.refetch()}>
            {t("report.retry")}
          </Button>
        </div>
      );
    }
    if (report.data?.status === "building") {
      return <p className="text-sm text-muted-foreground">{t("report.building")}</p>;
    }
    const data = report.data?.report as any;
    if (!data) return <p className="text-sm text-muted-foreground">{t("report.empty")}</p>;

    if (tab === "timeline") return <TimelineChart personaId={personaId} />;
    if (tab === "firsts") return <FirstsList personaId={personaId} mayFeature={featured} />;
    if (tab === "places") return <PlacesPanel personaId={personaId} />;
    if (tab === "songs") return <SongsPanel personaId={personaId} />;

    const total = data.totals.me + data.totals.them;
    if (total === 0) return <p className="text-sm text-muted-foreground">{t("report.empty")}</p>;
    const years = (data.byYear ?? []) as Array<{
      year: number;
      me: number;
      them: number;
      startsMe: number;
      startsThem: number;
      goodnightFirstMe: number;
      goodnightFirstThem: number;
      replyMedianSecMe: number | null;
      replyMedianSecThem: number | null;
      topTerms: string[];
    }>;
    return (
      <div className="space-y-6">
        <section>
          <h2 className="section-title">{t("report.monthlyTitle")}</h2>
          <div className="h-64" role="img" aria-label={t("report.monthlyTitle")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byMonth}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Legend />
                <Bar dataKey="me" name={t("records.me")} stackId="a" fill="currentColor" opacity={0.55} />
                <Bar dataKey="them" name={name} stackId="a" fill="currentColor" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <h2 className="section-title">{t("report.yearTitle")}</h2>
          <div className="h-56" role="img" aria-label={t("report.yearTitle")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={years}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="year" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Legend />
                <Bar dataKey="me" name={t("records.me")} fill="currentColor" opacity={0.55} />
                <Bar dataKey="them" name={name} fill="currentColor" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 space-y-1 text-sm">
            {years.map((year) => (
              <p key={year.year} className="text-muted-foreground">
                <span className="text-foreground">{year.year}</span>
                {" · "}
                {t("report.starts")} {year.startsMe} / {year.startsThem}
                {" · "}
                {t("report.goodnight")} {year.goodnightFirstMe} / {year.goodnightFirstThem}
                {" · "}
                {t("report.reply")}{" "}
                {year.replyMedianSecMe == null ? "—" : t("report.replies", { n: year.replyMedianSecMe })} /{" "}
                {year.replyMedianSecThem == null ? "—" : t("report.replies", { n: year.replyMedianSecThem })}
              </p>
            ))}
          </div>
        </section>

        <section>
          <h2 className="section-title">{t("report.heatmap")}</h2>
          <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
            {Array.from({ length: 24 }, (_, hour) =>
              Array.from({ length: 7 }, (__, day) => (
                <span
                  key={`${day}-${hour}`}
                  title={`${day} ${hour}`}
                  className="block h-3 rounded-sm"
                  style={{
                    opacity:
                      (data.heatmap?.[day]?.[hour] ?? 0) === 0
                        ? 0.08
                        : Math.min(1, 0.2 + (data.heatmap[day][hour] as number) / 20),
                    background: "currentColor",
                  }}
                />
              )),
            )}
          </div>
        </section>

        <section>
          <h2 className="section-title">{t("report.terms")}</h2>
          <div className="space-y-1 text-sm">
            {years.map((year) => (
              <p key={year.year} className="text-muted-foreground">
                <span className="text-foreground">{year.year}</span>：{year.topTerms.join("、") || "—"}
              </p>
            ))}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 p-3 text-sm">
            <p className="text-xs text-muted-foreground">{t("report.longestScene")}</p>
            {data.longestScene ? (
              <a
                href={`/persona/${personaId}/records?at=${data.longestScene.fromId}`}
                className="underline underline-offset-2"
              >
                {t("report.minutes", { n: data.longestScene.minutes })} · {data.longestScene.count}
              </a>
            ) : (
              <p className="text-muted-foreground">{t("report.noData")}</p>
            )}
          </div>
          <div className="rounded-lg border border-border/70 p-3 text-sm">
            <p className="text-xs text-muted-foreground">{t("report.longestSilence")}</p>
            {data.longestSilence ? (
              <a
                href={`/persona/${personaId}/records?atDate=${day(data.longestSilence.from)}`}
                className="underline underline-offset-2"
              >
                {t("report.days", { n: data.longestSilence.days })} · {day(data.longestSilence.from)}
              </a>
            ) : (
              <p className="text-muted-foreground">{t("report.noData")}</p>
            )}
          </div>
        </section>
      </div>
    );
  })();

  return (
    <main className="container max-w-5xl px-4 py-8 space-y-5">
      <header className="space-y-1.5">
        <h1 className="page-title">{t("report.title", { name })}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("report.note")}</p>
      </header>
      <div className="flex flex-wrap gap-1 border-b border-border pb-2" role="tablist" aria-label={t("report.title", { name })}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === item.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {labels[item.key]}
          </button>
        ))}
      </div>
      <div role="tabpanel">{content}</div>
      <p className="text-[11px] text-muted-foreground">{t("report.footer")}</p>
    </main>
  );
}
