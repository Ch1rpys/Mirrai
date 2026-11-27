/**
 * The keepsake book (C6.3).
 *
 * A page of things that were chosen, not generated: the two letters, the
 * dates the user wrote down, the changes they confirmed, the three lines
 * they kept, the lines they bookmarked, and the photos they ticked. The
 * browser's print dialog is how it becomes a PDF — the images need a
 * signed-in session, so a standalone file would not carry them.
 *
 * The share version leaves the photos out by default and puts the names
 * and numbers behind placeholders; one photo at a time can be ticked
 * back on.
 */
import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { ArrowLeft, BookOpen, Printer } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatDayKey } from "@/lib/dates";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import { Button } from "@/components/ui/button";

interface BookPhoto {
  id: number;
  url: string;
  at: string | null;
}

interface TimelineEntry {
  id: string;
  at: string;
  title: string;
  detail: string;
}

function dayOf(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

export default function Book() {
  const params = useParams<{ id: string }>();
  const personaId = Number.parseInt(params.id ?? "", 10);
  const hasPersonaId = Number.isInteger(personaId) && personaId > 0;
  const { isAuthenticated, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const { t, locale } = useLocale();
  const [share, setShare] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);

  const { data, isLoading, isError, refetch } = trpc.book.get.useQuery(
    { personaId, share, photoIds: picked },
    { enabled: isAuthenticated && hasPersonaId },
  );

  const selected = useMemo(() => new Set(picked), [picked]);

  if (!hasPersonaId) return <NotFound />;
  if (isLoading || authLoading) return <PageLoader />;
  if (isError || !data) {
    return (
      <div className="container page-main max-w-2xl">
        <p className="text-sm text-foreground/80">{t("book.failed")}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const togglePhoto = (id: number) => {
    setPicked((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : previous.length >= 24
          ? previous
          : [...previous, id],
    );
  };

  const time =
    data.cover.togetherFrom || data.cover.togetherTo
      ? `${data.cover.togetherFrom ?? ""}${data.cover.togetherFrom && data.cover.togetherTo ? " — " : ""}${data.cover.togetherTo ?? ""}`
      : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="book-toolbar sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button
            onClick={() => history.back()}
            className="app-nav-back -ml-1 gap-1"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">{t("common.back")}</span>
          </button>
          <div className="app-nav-title-group">
            <p className="kicker">{t("book.kicker")}</p>
            <p className="app-nav-title">{data.cover.name}</p>
          </div>
          <div className="app-nav-spacer" />
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5" /> {t("book.print")}
          </Button>
        </div>
        <div className="container pb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={share}
              onChange={(event) => setShare(event.target.checked)}
            />
            {t("book.share")}
          </label>
          {share && (
            <p className="text-xs text-muted-foreground">{t("book.shareNote")}</p>
          )}
        </div>
      </header>

      <main className="book-document container page-main max-w-2xl space-y-10">
        {share && (
          <p className="text-xs uppercase tracking-[0.2em] text-muted-subtle text-center">
            {t("book.shareBanner")}
          </p>
        )}

        <section className="text-center pt-6">
          <p className="kicker">{t("book.coverKicker")}</p>
          <h1 className="page-title mt-3">{data.cover.name}</h1>
          {time && <p className="text-sm text-muted-foreground mt-2">{time}</p>}
        </section>

        {(data.letters.theirs || data.letters.yours) && (
          <section>
            <h2 className="section-title mb-4">{t("book.letters")}</h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {data.letters.theirs && (
                <article>
                  <p className="text-xs uppercase tracking-wide text-muted-subtle mb-2">
                    {t("mutualLetters.theirLabel", { name: data.cover.name })}
                  </p>
                  <p className="text-[0.9375rem] leading-[1.9] whitespace-pre-wrap text-foreground/90">
                    {data.letters.theirs}
                  </p>
                </article>
              )}
              {data.letters.yours && (
                <article>
                  <p className="text-xs uppercase tracking-wide text-muted-subtle mb-2">
                    {t("mutualLetters.yourLabel")}
                  </p>
                  <p className="text-[0.9375rem] leading-[1.9] whitespace-pre-wrap text-foreground/90">
                    {data.letters.yours}
                  </p>
                </article>
              )}
            </div>
          </section>
        )}

        {data.timeline.length > 0 && (
          <section>
            <h2 className="section-title mb-4">{t("book.timeline")}</h2>
            <ol className="space-y-4">
              {data.timeline.map((entry: TimelineEntry) => (
                <li key={entry.id}>
                  <p className="text-xs text-muted-subtle">
                    {formatDayKey(entry.at.slice(0, 10), locale)}
                  </p>
                  <p className="text-sm text-foreground mt-0.5">{entry.title}</p>
                  {entry.detail && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed whitespace-pre-wrap">
                      {entry.detail}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {data.keptQuotes.length > 0 && (
          <section>
            <h2 className="section-title mb-4">{t("book.keptQuotes")}</h2>
            <ul className="space-y-3">
              {data.keptQuotes.map((quote: { recordId: number | null; text: string; at: string | null }) => (
                <li key={quote.recordId ?? quote.text}>
                  <p className="text-sm text-foreground whitespace-pre-wrap">「{quote.text}」</p>
                  {quote.at && (
                    <p className="text-[0.6875rem] text-muted-subtle mt-0.5">
                      {formatDayKey(dayOf(quote.at) ?? "", locale)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.bookmarks.length > 0 && (
          <section>
            <h2 className="section-title mb-4">{t("book.bookmarks")}</h2>
            <ul className="space-y-3">
              {data.bookmarks.map((mark: { recordId: number; text: string; at: string | null }) => (
                <li key={mark.recordId}>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{mark.text}</p>
                  {mark.at && (
                    <p className="text-[0.6875rem] text-muted-subtle mt-0.5">
                      {formatDayKey(dayOf(mark.at) ?? "", locale)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.photoOptions.length > 0 && (
          <section>
            <h2 className="section-title mb-2">{t("book.photos")}</h2>
            <p className="text-xs text-muted-foreground mb-3">{t("book.pickPhotos")}</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {data.photoOptions.map((photo: BookPhoto) => (
                <label key={photo.id} className="relative block">
                  <img
                    src={photo.url}
                    alt={t("book.photoAlt", { name: data.cover.name })}
                    className="w-full aspect-square object-cover rounded-md"
                  />
                  <input
                    type="checkbox"
                    className="absolute top-1 left-1"
                    checked={selected.has(photo.id)}
                    onChange={() => togglePhoto(photo.id)}
                    aria-label={t("book.pickPhoto")}
                  />
                </label>
              ))}
            </div>
            {data.photos.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 mt-4">
                {data.photos.map((photo: BookPhoto) => (
                  <figure key={photo.id}>
                    <img
                      src={photo.url}
                      alt={t("book.photoAlt", { name: data.cover.name })}
                      className="w-full rounded-md"
                    />
                    {photo.at && (
                      <figcaption className="text-[0.6875rem] text-muted-subtle mt-1">
                        {formatDayKey(dayOf(photo.at) ?? "", locale)}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}
          </section>
        )}

        <footer className="text-center text-xs text-muted-subtle pb-10 flex items-center justify-center gap-2">
          <BookOpen className="w-3.5 h-3.5" />
          {t("book.footer")}
        </footer>
      </main>
    </div>
  );
}
