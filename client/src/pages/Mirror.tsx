import { useParams, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { normalizeMirror } from "@shared/mirror";
import { DELAY_BANDS, DELAY_BUCKET_MIN, delayQuantiles } from "@shared/reply-delay";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";

/**
 * The mirror (C4.1).
 *
 * The same records as the profile, read from the user's side: what they
 * usually say, when they go quiet, how fast they answer, who opens, and
 * who makes peace first. Every row is a count, not a verdict, and the
 * page is the one place the persona never sees.
 */
export default function Mirror() {
  const params = useParams<{ id: string }>();
  const personaId = Number(params.id);
  const [, navigate] = useLocation();
  const { t } = useLocale();

  const persona = trpc.persona.get.useQuery({ id: personaId }, { enabled: personaId > 0 });
  const style = trpc.style.get.useQuery({ personaId }, { enabled: personaId > 0 });
  const mirror = normalizeMirror((style.data?.profile as any)?.mirror);

  if (!Number.isFinite(personaId) || personaId <= 0) return <NotFound />;
  if (persona.isLoading || style.isLoading) return <PageLoader />;
  if (persona.isError || style.isError) {
    const code = (persona.error as { data?: { code?: string } } | null)?.data?.code;
    if (code === "NOT_FOUND") return <NotFound />;
    return (
      <div className="container max-w-2xl py-16 text-center space-y-3">
        <p className="text-sm text-foreground/85">{t("common.error")}</p>
        <button
          type="button"
          className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
          onClick={() => { persona.refetch(); style.refetch(); }}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (!persona.data) return <NotFound />;

  const name = persona.data.name;
  const bandLabel = {
    night: t("profile.delayNight"),
    morning: t("profile.delayMorning"),
    afternoon: t("profile.delayAfternoon"),
    evening: t("profile.delayEvening"),
  } as const;

  function duration(seconds: number): string {
    return seconds >= 60
      ? t("mirror.minutes", { n: Math.round(seconds / 60) })
      : t("mirror.seconds", { n: Math.round(seconds) });
  }

  const exampleLink = (id: number) => (
    <button
      key={id}
      type="button"
      onClick={() => navigate(`/persona/${personaId}/records?at=${id}`)}
      className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
    >
      {t("mirror.example")}
    </button>
  );

  return (
    <div className="container max-w-2xl py-6 space-y-5">
      <header className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => navigate(`/persona/${personaId}/profile`)}
          aria-label={t("common.back")}
          className="app-nav-icon mt-1"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="page-title">{t("mirror.title")}</h1>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">{t("mirror.note")}</p>
        </div>
      </header>

      {!mirror ? (
        <p className="surface p-4 text-sm text-muted-foreground">{t("mirror.empty")}</p>
      ) : (
        <>
          {mirror.shortReplies.length > 0 ? (
            <section className="surface p-4 space-y-2">
              <h2 className="section-title">{t("mirror.shortTitle")}</h2>
              {mirror.shortReplies.slice(0, 3).map((entry) => (
                <div key={entry.text} className="text-sm leading-relaxed text-foreground/90">
                  <p>
                    {t("mirror.shortLine", {
                      text: entry.text,
                      n: entry.n,
                      k: entry.nextState.distant ?? 0,
                      name,
                    })}
                  </p>
                  <div className="mt-0.5 flex gap-2">{entry.exampleIds.slice(0, 3).map(exampleLink)}</div>
                </div>
              ))}
            </section>
          ) : null}

          {mirror.goingShort.episodes > 0 ? (
            <section className="surface p-4 space-y-1">
              <h2 className="section-title">{t("mirror.goingShortTitle")}</h2>
              <p className="text-sm leading-relaxed text-foreground/90">
                {t("mirror.goingShortLine", { n: mirror.goingShort.episodes })}
              </p>
              {mirror.goingShort.exampleIds.slice(0, 3).map(exampleLink)}
            </section>
          ) : null}

          {mirror.myDelay ? (
            <section className="surface p-4 space-y-2">
              <h2 className="section-title">{t("mirror.delayTitle")}</h2>
              <ul className="space-y-1 text-sm leading-relaxed text-foreground/90">
                {DELAY_BANDS.map((band) => {
                  const bucket = mirror.myDelay?.buckets[band];
                  return (
                    <li key={band}>
                      {bucket && bucket.n >= DELAY_BUCKET_MIN
                        ? t("mirror.delayRow", {
                            band: bandLabel[band],
                            value: duration(delayQuantiles(bucket).medianSec),
                          })
                        : t("mirror.delayThin", { band: bandLabel[band] })}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-0.5 flex gap-2">
                {mirror.myDelayExampleIds.slice(0, 3).map(exampleLink)}
              </div>
            </section>
          ) : null}

          {mirror.repairBy ? (
            <section className="surface p-4 space-y-1">
              <h2 className="section-title">{t("mirror.repairTitle")}</h2>
              <p className="text-sm leading-relaxed text-foreground/90">
                {t("mirror.repairLine", {
                  me: mirror.repairBy.me,
                  them: mirror.repairBy.them,
                  name,
                })}
              </p>
              <div className="mt-0.5 flex gap-2">
                {mirror.repairExampleIds.slice(0, 3).map(exampleLink)}
              </div>
            </section>
          ) : null}

          {mirror.starts.me + mirror.starts.them > 0 ? (
            <section className="surface p-4 space-y-1">
              <h2 className="section-title">{t("mirror.startsTitle")}</h2>
              <p className="text-sm leading-relaxed text-foreground/90">
                {t("mirror.startsLine", { me: mirror.starts.me, them: mirror.starts.them, name })}
              </p>
              <div className="mt-0.5 flex gap-2">
                {mirror.startExampleIds.slice(0, 3).map(exampleLink)}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
