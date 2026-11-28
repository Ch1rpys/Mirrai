import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { formatInstantInZone } from "@/lib/dates";
import { renderRecordContent } from "@shared/records";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CrisisCard from "@/components/CrisisCard";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";

/**
 * "Read this line" (C3.4).
 *
 * The page shows what the record holds around a sentence the person sent:
 * the rules the user confirmed that mention it, the times they really
 * said it, and what usually followed. It gives precedents, never a
 * verdict — there is no sentence anywhere here that says what they meant.
 *
 * The pasted line is user input (WP12's rule), so a crisis is answered
 * with the crisis card instead of a reading. The server short-circuits
 * the decoder; this page only draws the flag it sends back.
 */
interface DecodeRowView {
  id: number;
  role: string;
  speaker: string | null;
  content: string;
  kind: string | null;
  meta: Record<string, unknown> | null;
  at: string | null;
}

export default function Decode() {
  const params = useParams<{ id: string }>();
  const personaId = Number(params.id);
  const [, navigate] = useLocation();
  const { t, locale } = useLocale();

  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [crisisDismissed, setCrisisDismissed] = useState(false);

  const persona = trpc.persona.get.useQuery({ id: personaId }, { enabled: personaId > 0 });
  /**
   * The search is a query that writes one thing: when the pasted line is
   * a crisis, the server records a safety event before it answers
   * (C3.4). A query that writes is the wrong shape, so nothing may run
   * it again on its own: no refetch on focus/reconnect, no retry, and a
   * cache that never goes stale while the page is open. A new line has a
   * new query key, so submitting still asks once. Deviation 641 records
   * why this is not a mutation yet.
   */
  const decoded = trpc.record.decode.useQuery(
    { personaId, text: asked },
    {
      enabled: personaId > 0 && asked.length > 0,
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    },
  );

  if (!Number.isFinite(personaId) || personaId <= 0) return <NotFound />;
  if (persona.isLoading) return <PageLoader />;
  if (persona.isError) {
    const code = (persona.error as { data?: { code?: string } } | null)?.data?.code;
    if (code === "NOT_FOUND") return <NotFound />;
    return (
      <div className="container max-w-2xl py-16 text-center space-y-3">
        <p className="text-sm text-foreground/85">{t("common.error")}</p>
        <Button variant="outline" onClick={() => persona.refetch()}>{t("common.retry")}</Button>
      </div>
    );
  }
  if (!persona.data) return <NotFound />;

  const name = persona.data.name;

  function duration(seconds: number): string {
    if (seconds >= 60) return t("decode.gapMinutes", { n: Math.round(seconds / 60) });
    return t("decode.gapSeconds", { n: Math.round(seconds) });
  }

  function contextRow(row: DecodeRowView) {
    return (
      <li key={row.id} className="flex gap-2 py-1 text-xs">
        <span className="shrink-0 text-muted-subtle">
          {row.speaker || (row.role === "user" ? t("common.me") : name)}
        </span>
        <span className="min-w-0 flex-1 text-foreground/85 leading-relaxed">
          {renderRecordContent(
            { kind: (row.kind ?? "text") as never, content: row.content, meta: row.meta },
            locale === "en" ? "en" : "zh",
          )}
        </span>
        {row.at ? (
          <span className="shrink-0 text-muted-subtle">{formatInstantInZone(row.at, locale)}</span>
        ) : null}
      </li>
    );
  }

  const result = decoded.data;

  return (
    <div className="container max-w-2xl py-6 space-y-5">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(`/persona/${personaId}/profile`)}
          aria-label={t("common.back")}
          className="app-nav-icon"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="page-title">{t("decode.title")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t("decode.note")}</p>
        </div>
      </header>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = draft.trim();
          if (!trimmed) return;
          // A new line is a new answer; the card the last one opened is
          // not this one's.
          setCrisisDismissed(false);
          setAsked(trimmed);
        }}
      >
        <Textarea
          value={draft}
          rows={2}
          maxLength={500}
          placeholder={t("decode.placeholder", { name })}
          aria-label={t("decode.placeholder", { name })}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!draft.trim() || decoded.isFetching}>
            {t("decode.submit")}
          </Button>
        </div>
      </form>

      {decoded.isFetching ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : decoded.isError ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{t("common.error")}</p>
          <button
            type="button"
            onClick={() => decoded.refetch()}
            className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : result?.crisis ? (
        /**
         * A crisis is the whole answer: the card, and none of the three
         * blocks. Putting it away leaves the page quiet until the user
         * asks about another line.
         */
        crisisDismissed ? null : <CrisisCard onClose={() => setCrisisDismissed(true)} />
      ) : result ? (
        <div className="space-y-5">
          <section className="surface p-4 space-y-2">
            <h2 className="section-title">{t("decode.rulesTitle")}</h2>
            {result.rules.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("decode.rulesEmpty")}</p>
            ) : (
              <ul className="space-y-2">
                {result.rules.map((rule) => (
                  <li key={rule.id} className="text-sm leading-relaxed">
                    <p className="text-foreground/90">{rule.meaning}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("decode.ruleRendering", { rendering: rule.rendering })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface p-4 space-y-2">
            <h2 className="section-title">{t("decode.precedentsTitle", { name })}</h2>
            {result.precedents.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("decode.noPrecedents", { name })}</p>
            ) : (
              <ul className="space-y-3">
                {result.precedents.map((precedent) => {
                  const expanded = open.has(precedent.id);
                  return (
                    <li key={precedent.id} className="border-b border-border/50 pb-2 last:border-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-foreground/90 leading-relaxed">{precedent.content}</p>
                        <span className="shrink-0 text-[11px] text-muted-subtle">
                          {precedent.at ? formatInstantInZone(precedent.at, locale) : ""}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setOpen((current) => {
                              const next = new Set(current);
                              if (next.has(precedent.id)) next.delete(precedent.id);
                              else next.add(precedent.id);
                              return next;
                            })
                          }
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {expanded ? t("decode.hideContext") : t("decode.showContext")}
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/persona/${personaId}/records?at=${precedent.id}`)}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <BookOpen className="w-3 h-3" />
                          {t("decode.openReader")}
                        </button>
                      </div>
                      {expanded ? (
                        <ul className="mt-2 space-y-0.5">
                          {[
                            ...precedent.before,
                            {
                              id: precedent.id,
                              role: "assistant",
                              speaker: name,
                              content: precedent.content,
                              kind: "text",
                              meta: null,
                              at: precedent.at,
                            } satisfies DecodeRowView,
                            ...precedent.after,
                          ].map((row) => contextRow(row as DecodeRowView))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="surface p-4 space-y-2">
            <h2 className="section-title">{t("decode.afterTitle")}</h2>
            {result.after.count === 0 ? (
              <p className="text-xs text-muted-foreground">{t("decode.noPrecedents", { name })}</p>
            ) : (
              <div className="space-y-1.5 text-sm leading-relaxed text-foreground/90">
                {result.after.gapMedianSec === null ? (
                  <p>{t("decode.gapNone", { name })}</p>
                ) : (
                  <p>
                    {t("decode.gapLine", {
                      n: result.after.count,
                      name,
                      gap: duration(result.after.gapMedianSec),
                    })}
                  </p>
                )}
                {result.after.states.map((state) => (
                  <p key={state.state}>
                    {t("decode.stateLine", {
                      k: state.n,
                      state: t(`emotions.${state.state}.label` as never),
                    })}
                  </p>
                ))}
              </div>
            )}
          </section>

          <p className="text-xs text-muted-foreground leading-relaxed">{t("decode.fixedNote", { name })}</p>
        </div>
      ) : null}
    </div>
  );
}
