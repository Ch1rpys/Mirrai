import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * Search the record, literally and by meaning (C2.2).
 *
 * Two groups: the lines that contain the words, and the lines that say
 * the same thing another way. The second group is absent — with a line
 * saying why — when the local embedding model is not running.
 */

interface Hit {
  id: number;
  content: string;
  timestamp: string | null;
  role?: string;
  speaker?: string | null;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0 || !query) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-primary/20 px-0.5">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

export default function RecordSearch({
  personaId,
  name,
  onJump,
}: {
  personaId: number;
  name: string;
  onJump: (recordId: number) => void;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"assistant" | "all">("assistant");
  const [contextFor, setContextFor] = useState<number | null>(null);
  /**
   * The extra pages of the literal results.
   *
   * The route answers thirty at a time and returns the next cursor.
   * The panel used to ignore it, so lines beyond the first thirty were
   * unreachable from the reader's search box.
   */
  const [moreExact, setMoreExact] = useState<Hit[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [fetchedMore, setFetchedMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    setMoreExact([]);
    setNextCursor(null);
    setFetchedMore(false);
  }, [q, role]);
  const query = trpc.record.search.useQuery(
    { personaId, q: q.trim(), role },
    { enabled: q.trim().length > 0 },
  );
  const context = trpc.record.context.useQuery(
    { personaId, recordId: contextFor ?? 0, before: 2, after: 2 },
    { enabled: contextFor != null },
  );

  const data = query.data;
  const exact = [...(data?.exact ?? []), ...moreExact];
  const next = fetchedMore ? nextCursor : data?.next ?? null;
  const loadMore = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await utils.record.search.fetch({
        personaId,
        q: q.trim(),
        role,
        cursor: next,
      });
      setMoreExact((current) => [...current, ...page.exact]);
      setNextCursor(page.next);
      setFetchedMore(true);
    } catch {
      /* The list stays as it was; the query's own error state is shown. */
    } finally {
      setLoadingMore(false);
    }
  };
  const showGroups = q.trim().length > 0 && !query.isLoading;
  const speakerOf = (hit: Hit) =>
    hit.role === "user" ? t("records.me") : hit.speaker ?? name;

  return (
    <section className="space-y-2" aria-label={t("records.search", { name })}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-subtle" />
          <input
            type="search"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setContextFor(null);
            }}
            placeholder={t("records.search", { name })}
            aria-label={t("records.search", { name })}
            className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-primary/50"
          />
        </label>
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          <button
            type="button"
            className={`rounded px-2 py-1 text-xs ${role === "assistant" ? "bg-primary/15" : ""}`}
            onClick={() => setRole("assistant")}
          >
            {t("records.searchThem")}
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 text-xs ${role === "all" ? "bg-primary/15" : ""}`}
            onClick={() => setRole("all")}
          >
            {t("records.searchAll")}
          </button>
        </div>
      </div>

      {query.isError && (
        <p className="text-xs text-destructive" role="alert">
          {t("records.searchFailed")}
        </p>
      )}

      {showGroups && data && exact.length === 0 && (data.similar?.length ?? 0) === 0 && (
        <p className="text-xs text-muted-foreground">{t("records.noResults", { q: q.trim() })}</p>
      )}

      {data && exact.length > 0 && (
        <div className="rounded-lg border border-border/70 p-2">
          <p className="px-1 py-1 text-[0.625rem] uppercase tracking-wide text-muted-subtle">
            {t("records.exactGroup")}
          </p>
          {exact.map((hit: Hit) => (
            <div key={hit.id} className="rounded px-1 py-1 text-sm hover:bg-muted/40">
              <button
                type="button"
                className="block w-full text-left"
                aria-label={hit.content}
                onClick={() => onJump(hit.id)}
              >
                <Highlighted text={hit.content} query={q.trim()} />
                <span className="ml-2 text-[11px] text-muted-foreground">
                  {speakerOf(hit)}
                  {hit.timestamp ? ` · ${hit.timestamp.slice(0, 10)}` : ""}
                </span>
              </button>
              <button
                type="button"
                className="mt-0.5 text-[11px] text-muted-foreground underline"
                onClick={() => setContextFor(contextFor === hit.id ? null : hit.id)}
              >
                {contextFor === hit.id ? t("records.hideContext") : t("records.showContext")}
              </button>
              {contextFor === hit.id && context.data && (
                <div className="mt-1 space-y-0.5 border-l border-border pl-2 text-xs text-muted-foreground">
                  {[...context.data.before, context.data.target, ...context.data.after].map((line) => (
                    <p key={line.id} className={line.id === hit.id ? "text-foreground" : ""}>
                      {line.content}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
          {next && (
            <button
              type="button"
              className="mt-1 w-full rounded px-1 py-1 text-[11px] text-muted-foreground underline"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {t("records.loadMore")}
            </button>
          )}
        </div>
      )}

      {data?.similar === null && q.trim().length > 0 && (
        <p className="text-xs text-muted-foreground">{t("records.semanticUnavailable")}</p>
      )}

      {data && data.similar && data.similar.length > 0 && (
        <div className="rounded-lg border border-border/70 p-2">
          <p className="px-1 py-1 text-[0.625rem] uppercase tracking-wide text-muted-subtle">
            {t("records.similarGroup")}
          </p>
          {data.similar.map((hit: Hit) => (
            <button
              key={hit.id}
              type="button"
              className="block w-full rounded px-1 py-1 text-left text-sm hover:bg-muted/40"
              onClick={() => onJump(hit.id)}
            >
              {hit.content}
              <span className="ml-2 text-[11px] text-muted-foreground">
                {speakerOf(hit)}
                {hit.timestamp ? ` · ${hit.timestamp.slice(0, 10)}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      {(data?.semanticTruncated ?? false) && (
        <p className="text-[11px] text-muted-foreground">
          {t("records.semanticTruncated")}
        </p>
      )}
    </section>
  );
}
