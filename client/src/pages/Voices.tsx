import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Play, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { formatInstantInZone } from "@/lib/dates";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";

/**
 * The recordings in the record.
 *
 * Every row here is a real voice note that came with an export. None of
 * it is synthesised, and the page says so — a listener has to be able
 * to tell the person's own voice from the read-aloud voice, which is
 * synthesised and lives only on the chat page.
 */

interface VoiceRow {
  id: number;
  at: string | null;
  durationSec: number | null;
  fromThem: boolean;
  transcript: string | null;
  transcriptEngine: string | null;
  url: string;
  recordId: number | null;
}

export default function Voices() {
  const params = useParams<{ id: string }>();
  const personaId = Number(params.id);
  const [, navigate] = useLocation();
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const timezone = (user as { timezone?: string | null })?.timezone ?? null;

  const [q, setQ] = useState("");
  const [onlyTheirs, setOnlyTheirs] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [rows, setRows] = useState<VoiceRow[]>([]);

  const persona = trpc.persona.get.useQuery({ id: personaId }, { enabled: personaId > 0 });
  const voices = trpc.media.listVoices.useQuery(
    {
      personaId,
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(onlyTheirs ? { fromThem: true } : {}),
      ...(cursor ? { cursor } : {}),
    },
    { enabled: personaId > 0 },
  );
  const status = trpc.media.transcribeStatus.useQuery(
    { personaId },
    {
      enabled: personaId > 0,
      // The task runs in the background; the page follows it until it
      // stops, then leaves it alone.
      refetchInterval: (query) =>
        query.state.data?.run.running ? 2000 : false,
    },
  );
  const transcribe = trpc.media.transcribe.useMutation({
    onSuccess: () => {
      void status.refetch();
      void voices.refetch();
    },
  });

  // A new search starts at the newest page again.
  useEffect(() => {
    setCursor(undefined);
    setRows([]);
  }, [q, onlyTheirs]);

  useEffect(() => {
    if (!voices.data) return;
    const page = voices.data.voices as VoiceRow[];
    setRows((previous) => {
      const seen = new Set(previous.map((row) => row.id));
      const added = page.filter((row) => !seen.has(row.id));
      // The first page replaces what is there; later pages add to it.
      if (cursor === undefined) return page;
      return [...previous, ...added];
    });
  }, [voices.data, cursor]);

  if (!Number.isFinite(personaId) || personaId <= 0) return <NotFound />;
  if (persona.isLoading) return <PageLoader />;
  if (!persona.data) return <NotFound />;

  const name = persona.data.name;
  const nextCursor = voices.data?.nextCursor ?? null;
  const run = status.data?.run;
  const localEngine = status.data?.local ?? false;

  return (
    <main className="container max-w-3xl px-4 py-8 space-y-5">
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="ghost"
          className="rounded-md"
          onClick={() => navigate(`/persona/${personaId}/profile`)}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t("common.back")}
        </Button>
      </div>

      <header className="space-y-1.5">
        <h1 className="page-title">{t("media.voicesTitle", { name })}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("media.voicesNote")}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-subtle" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={t("media.voicesSearch")}
            aria-label={t("media.voicesSearch")}
            className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-primary/50"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyTheirs}
            onChange={(event) => setOnlyTheirs(event.target.checked)}
          />
          {t("media.voicesOnlyTheirs", { name })}
        </label>
      </div>

      {/**
       * Transcription is optional and only local.
       *
       * The other person's recordings are not sent to a cloud service;
       * when no local engine is configured the page says what to set
       * rather than offering a button that cannot run.
       */}
      {rows.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-1.5">
          {localEngine ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {run?.running
                    ? t("media.transcribing", {
                        done: run.done + run.failed,
                        total: run.total,
                      })
                    : t("media.transcribeHint")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={transcribe.isPending || Boolean(run?.running)}
                  onClick={() => transcribe.mutate({ personaId })}
                >
                  {t("media.transcribeAction")}
                </Button>
              </div>
              {run && !run.running && run.total > 0 && (
                <p className="text-[11px] text-muted-subtle">
                  {t("media.transcribeDone", {
                    done: run.done,
                    failed: run.failed,
                  })}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("media.voicesNoEngine")}
            </p>
          )}
        </div>
      )}

      {voices.isLoading && rows.length === 0 ? (
        <PageLoader />
      ) : voices.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("media.voicesLoadFailed")}</p>
          <Button size="sm" variant="outline" onClick={() => voices.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("media.voicesEmpty", { name })}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="surface p-3 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-muted">
                <span className="text-foreground text-sm">
                  {row.at
                    ? formatInstantInZone(row.at, locale, timezone)
                    : t("media.voicesNoDate")}
                </span>
                <span className="text-muted-subtle">
                  {row.fromThem ? name : t("common.me")}
                  {row.durationSec != null
                    ? ` · ${t("media.voicesSeconds", { n: row.durationSec })}`
                    : ""}
                </span>
              </div>
              <audio controls preload="none" src={row.url} className="w-full h-9" />
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {row.transcript?.trim()
                  ? row.transcript
                  : t("media.voicesUntranscribed")}
              </p>
              {row.recordId != null && (
                /**
                 * The reader (C2.10) lands in WP11. Until it does, the
                 * line number is shown so the row can be found by hand.
                 */
                <p className="text-[11px] text-muted-subtle">
                  {t("media.voicesRecord", { id: row.recordId })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {nextCursor != null && (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" onClick={() => setCursor(nextCursor)}>
            {t("media.voicesLoadMore")}
          </Button>
        </div>
      )}
    </main>
  );
}
