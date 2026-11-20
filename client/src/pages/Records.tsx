import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft, Bookmark, Copy, NotebookPen, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { formatInstantInZone } from "@/lib/dates";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";

/**
 * The timeline reader (C2.10).
 *
 * Every line here is one row of the record, in the order it was said.
 * The page reads it two hundred at a time; nothing is generated, and a
 * line the harm filter flagged is folded until the user opens it.
 */

interface RecordRow {
  id: number;
  role: string;
  speaker: string | null;
  kind: string;
  timestamp: string;
  content: string;
  source: string;
  fileId: number | null;
  meta: Record<string, unknown> | null;
  media: { url: string; kind: string; durationSec: number | null; transcript: string | null } | null;
  harmful: boolean;
  marks: Array<{ kind: string; note: string | null }>;
}

interface PageData {
  rows: RecordRow[];
  hasOlder: boolean;
  hasNewer: boolean;
}

type LoadMode = "replace" | "prepend" | "append";

type PageAnchor = { recordId: number } | { at: string };

interface PageRequest {
  anchor?: PageAnchor;
  direction: "older" | "newer" | "around";
  limit: number;
}

export default function Records() {
  const params = useParams<{ id: string }>();
  const personaId = Number(params.id);
  const [, navigate] = useLocation();
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const timezone = (user as { timezone?: string | null })?.timezone ?? null;
  const confirm = useConfirm();

  const initialAnchor = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const at = new URLSearchParams(window.location.search).get("at");
    const id = at ? Number(at) : NaN;
    return Number.isFinite(id) && id > 0 ? id : undefined;
  }, []);

  const [highlightId] = useState<number | undefined>(initialAnchor);
  const [request, setRequest] = useState<PageRequest>(() =>
    initialAnchor
      ? { anchor: { recordId: initialAnchor }, direction: "around", limit: 200 }
      : { direction: "older", limit: 200 },
  );
  const modeRef = useRef<LoadMode>("replace");
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [copied, setCopied] = useState(false);
  const [jumpDate, setJumpDate] = useState("");
  const [search, setSearch] = useState("");

  const persona = trpc.persona.get.useQuery({ id: personaId }, { enabled: personaId > 0 });
  const pageQuery = trpc.record.page.useQuery(
    { personaId, ...request },
    { enabled: personaId > 0 },
  );
  const outline = trpc.record.outline.useQuery({ personaId }, { enabled: personaId > 0 });
  const marks = trpc.record.marks.list.useQuery({ personaId }, { enabled: personaId > 0 });
  const utils = trpc.useUtils();

  const requestAnchorId = useRef<number | null>(null);
  const addMark = trpc.record.marks.add.useMutation({
    onSuccess: () => {
      void utils.record.marks.list.invalidate({ personaId });
    },
  });
  const removeMark = trpc.record.marks.remove.useMutation({
    onSuccess: () => {
      void utils.record.marks.list.invalidate({ personaId });
    },
  });
  const deleteRow = trpc.record.delete.useMutation({
    onSuccess: () => {
      setRows((current) => current.filter((row) => row.id !== requestAnchorId.current));
      void utils.record.marks.list.invalidate({ personaId });
    },
  });
  useEffect(() => {
    if (!pageQuery.data) return;
    const page = pageQuery.data as PageData;
    const mode = modeRef.current;
    modeRef.current = "replace";
    setHasOlder(page.hasOlder);
    setHasNewer(page.hasNewer);
    setRows((current) => {
      if (mode === "prepend") {
        const seen = new Set(current.map((row) => row.id));
        return [...page.rows.filter((row) => !seen.has(row.id)), ...current];
      }
      if (mode === "append") {
        const seen = new Set(current.map((row) => row.id));
        return [...current, ...page.rows.filter((row) => !seen.has(row.id))];
      }
      return page.rows;
    });
  }, [pageQuery.data]);

  useEffect(() => {
    if (!highlightId) return;
    const line = document.querySelector(`[data-record-id="${highlightId}"]`);
    line?.scrollIntoView?.({ block: "center" });
  }, [highlightId, rows.length]);

  const jumpTo = useCallback(
    (anchor: PageAnchor, direction: "older" | "newer" | "around") => {
      modeRef.current = "replace";
      setRequest({ anchor, direction, limit: 200 });
    },
    [],
  );

  if (!Number.isFinite(personaId) || personaId <= 0) return <NotFound />;
  if (persona.isLoading) return <PageLoader />;
  if (!persona.data) return <NotFound />;

  const name = persona.data.name;
  const bookmarkByRecord = new Map<number, { id: number; content: string | null }>();
  const bookmarks = (marks.data ?? []).filter((mark) => mark.kind === "bookmark");
  for (const mark of bookmarks) {
    bookmarkByRecord.set(mark.recordId, { id: mark.id, content: mark.content });
  }
  const outlineMonths = outline.data?.months ?? [];
  const periods = outline.data?.periods ?? [];

  const loadOlder = () => {
    if (!rows.length) return;
    modeRef.current = "prepend";
    setRequest({ anchor: { recordId: rows[0].id }, direction: "older", limit: 200 });
  };
  const loadNewer = () => {
    if (!rows.length) return;
    modeRef.current = "append";
    setRequest({ anchor: { recordId: rows[rows.length - 1].id }, direction: "newer", limit: 200 });
  };
  const loadDate = () => {
    if (!jumpDate) return;
    // The date input is the user's own calendar day; the reader's
    // records are wall-clock times, so local midnight is the anchor.
    const at = new Date(`${jumpDate}T00:00:00`).toISOString();
    jumpTo({ at }, "around");
  };

  const toggleBookmark = (row: RecordRow) => {
    const mark = bookmarkByRecord.get(row.id);
    if (mark) removeMark.mutate({ personaId, id: mark.id });
    else addMark.mutate({ personaId, recordId: row.id, kind: "bookmark" });
  };

  const copyRow = async (row: RecordRow) => {
    try {
      await navigator.clipboard.writeText(row.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* The browser refused the clipboard; the line is still on screen. */
    }
  };

  const askDelete = async (row: RecordRow) => {
    const ok = await confirm({
      title: t("records.deleteTitle"),
      description: t("records.deleteBody"),
      confirmLabel: t("records.deleteConfirm"),
    });
    if (!ok) return;
    requestAnchorId.current = row.id;
    deleteRow.mutate({ personaId, recordId: row.id });
  };

  return (
    <main className="container max-w-6xl px-4 py-8">
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="ghost"
          className="rounded-md"
          onClick={() => navigate(`/persona/${personaId}/profile`)}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t("records.back")}
        </Button>
      </div>

      <header className="mt-3 space-y-1.5">
        <h1 className="page-title">{t("records.title", { name })}</h1>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            {t("records.jumpDate")}
            <input
              type="date"
              value={jumpDate}
              onChange={(event) => setJumpDate(event.target.value)}
              aria-label={t("records.jumpDate")}
              className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <Button size="sm" variant="outline" onClick={loadDate} disabled={!jumpDate}>
            {t("records.jump")}
          </Button>
          <label className="relative flex-1 min-w-[220px]">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("records.search", { name })}
              aria-label={t("records.search", { name })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
          </label>
          {copied && <span className="text-xs text-muted-foreground">{t("records.copied")}</span>}
        </div>
      </header>

      <div className="mt-5 grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section>
            <h2 className="kicker">{t("records.chapters")}</h2>
            {periods.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-muted-foreground">{t("records.periods")}</p>
                {periods.map((period) => (
                  <button
                    key={period.id}
                    type="button"
                    className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted"
                    onClick={() => period.from && jumpTo({ at: new Date(period.from).toISOString() }, "around")}
                  >
                    {period.label ?? period.id}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 space-y-1">
              {outlineMonths.map((month) => (
                <button
                  key={month.month}
                  type="button"
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => jumpTo({ at: new Date(`${month.month}-01T00:00:00`).toISOString() }, "around")}
                >
                  <span>{month.month}</span>
                  <span className="text-xs text-muted-foreground">{month.count}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="kicker">{t("records.bookmarks")}</h2>
            {bookmarks.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("records.noBookmarks")}</p>
            ) : (
              <div className="mt-2 space-y-1">
                {bookmarks.map((mark) => (
                  <button
                    key={mark.id}
                    type="button"
                    className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted"
                    onClick={() => jumpTo({ recordId: mark.recordId }, "around")}
                  >
                    {mark.content ?? `#${mark.recordId}`}
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section aria-label={t("records.title", { name })}>
          {pageQuery.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("records.loading")}</p>
          )}
          {pageQuery.isError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p>{t("records.failed")}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => pageQuery.refetch()}>
                {t("records.retry")}
              </Button>
            </div>
          )}
          {!pageQuery.isLoading && !pageQuery.isError && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("records.empty")}</p>
          )}

          <div className="space-y-3">
            {rows.map((row, index) => {
              const previous = rows[index - 1];
              const isMine = row.role === "user";
              const folded = row.harmful && !expanded.has(row.id);
              const bookmark = bookmarkByRecord.get(row.id);
              const head = (
                <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                  <div
                    data-record-id={row.id}
                    className={`max-w-[80%] rounded-lg border px-3 py-2 text-sm ${
                      isMine
                        ? "bg-primary/10 border-primary/20"
                        : "bg-muted/40 border-border/70"
                    } ${highlightId === row.id ? "ring-2 ring-primary/40" : ""}`}
                  >
                    <p className="text-[11px] text-muted-foreground">
                      {isMine ? t("records.me") : row.speaker ?? name}
                    </p>
                    {row.media?.kind === "photo" || row.kind === "image" ? (
                      row.media?.url ? (
                        <img src={row.media.url} alt={row.content} className="mt-1 max-h-64 rounded" />
                      ) : (
                        <p className="mt-1">{row.content}</p>
                      )
                    ) : row.media?.kind === "voice" || row.kind === "voice" ? (
                      row.media?.url ? (
                        <audio controls src={row.media.url} className="mt-1 w-full" />
                      ) : (
                        <p className="mt-1">{row.content}</p>
                      )
                    ) : folded ? (
                      <button
                        type="button"
                        className="mt-1 text-left text-sm text-muted-foreground underline"
                        aria-label={t("records.open")}
                        onClick={() =>
                          setExpanded((current) => new Set(current).add(row.id))
                        }
                      >
                        {t("records.folded")}
                      </button>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap">{row.content}</p>
                    )}
                    {row.marks
                      .filter((mark) => mark.kind === "note" && mark.note)
                      .map((mark) => (
                        <p key={mark.note} className="mt-1 border-t border-border/50 pt-1 text-xs text-muted-foreground">
                          {mark.note}
                        </p>
                      ))}
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        aria-label={bookmark ? t("records.unbookmark") : t("records.bookmark")}
                        className="rounded p-1 hover:bg-muted"
                        onClick={() => toggleBookmark(row)}
                      >
                        <Bookmark className={`w-3.5 h-3.5 ${bookmark ? "fill-current" : ""}`} />
                      </button>
                      <button
                        type="button"
                        aria-label={t("records.note")}
                        className="rounded p-1 hover:bg-muted"
                        onClick={() => {
                          setNoteFor(row.id);
                          setNoteText(row.marks.find((mark) => mark.kind === "note")?.note ?? "");
                        }}
                      >
                        <NotebookPen className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("records.copy")}
                        className="rounded p-1 hover:bg-muted"
                        onClick={() => copyRow(row)}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("records.delete")}
                        className="rounded p-1 hover:bg-muted"
                        onClick={() => askDelete(row)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {noteFor === row.id && (
                      <div className="mt-2 space-y-1">
                        <textarea
                          value={noteText}
                          onChange={(event) => setNoteText(event.target.value)}
                          maxLength={1000}
                          placeholder={t("records.notePlaceholder")}
                          aria-label={t("records.notePlaceholder")}
                          className="w-full rounded border border-border bg-background p-2 text-xs"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              addMark.mutate({
                                personaId,
                                recordId: row.id,
                                kind: "note",
                                note: noteText,
                              });
                              setNoteFor(null);
                            }}
                          >
                            {t("records.saveNote")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setNoteFor(null)}>
                            {t("records.cancel")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
              return (
                <div key={row.id} className="space-y-1">
                  {previous &&
                    new Date(row.timestamp).getTime() - new Date(previous.timestamp).getTime() >
                      5 * 60_000 && (
                      <p className="text-center text-[11px] text-muted-foreground">
                        {formatInstantInZone(row.timestamp, locale, timezone)}
                      </p>
                    )}
                  {head}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={loadOlder} disabled={!hasOlder}>
              {t("records.older")}
            </Button>
            <Button size="sm" variant="outline" onClick={loadNewer} disabled={!hasNewer}>
              {t("records.newer")}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
