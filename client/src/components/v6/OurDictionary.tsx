import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { normalizeLexicon, type LexiconEntry } from "@shared/lexicon";

/**
 * The dictionary of words only the two of them use (C2.7).
 *
 * It is the reading page of B3.7: no new measurement, no new data. A
 * candidate becomes a word only when the user says so, and the gloss is
 * theirs to change.
 */
export default function OurDictionary({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const persona = trpc.persona.get.useQuery({ id: personaId }, { enabled: personaId > 0 });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const save = trpc.lexicon.save.useMutation({
    onSuccess: () => {
      setDrafts({});
      void utils.persona.get.invalidate({ id: personaId });
    },
  });

  const entries = useMemo(
    () => normalizeLexicon((persona.data?.personaData as { lexicon?: unknown } | null)?.lexicon),
    [persona.data],
  );

  if (persona.isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (persona.isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p>{t("report.failed")}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => persona.refetch()}>
          {t("report.retry")}
        </Button>
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="our-dictionary space-y-2">
        <h2 className="section-title">{t("report.dictionary.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("report.dictionary.empty")}</p>
      </div>
    );
  }

  const confirmed = entries.filter((entry) => entry.verified);
  const candidates = entries.filter((entry) => !entry.verified);

  const persist = (next: LexiconEntry[]) =>
    save.mutate({
      personaId,
      entries: next.map((entry) => ({
        id: entry.id,
        term: entry.term,
        gloss: entry.gloss,
        who: entry.who,
        count: entry.count,
        ...(entry.firstAt ? { firstAt: entry.firstAt } : {}),
        evidence: entry.evidence.map((row) => ({
          ...(row.at ? { at: row.at } : {}),
          snippet: row.snippet,
        })),
        source: entry.source,
        verified: entry.verified,
      })),
    });

  const confirm = (entry: LexiconEntry) =>
    persist(
      entries.map((row) =>
        row.id === entry.id
          ? { ...row, gloss: entry.gloss, source: entry.source, verified: true }
          : row,
      ),
    );
  const reject = (entry: LexiconEntry) =>
    persist(entries.filter((row) => row.id !== entry.id));

  const whoLabel = (entry: LexiconEntry) =>
    entry.who === "them"
      ? t("report.dictionary.them")
      : entry.who === "me"
        ? t("report.dictionary.me")
        : t("report.dictionary.both");

  const renderEntry = (entry: LexiconEntry, candidate: boolean) => {
    const first = entry.evidence[0];
    const date = first?.at?.slice(0, 10) ?? entry.firstAt?.slice(0, 10) ?? "";
    return (
      <div key={entry.id} className="rounded border border-border/70 px-3 py-2 text-sm">
        <p className="text-foreground">
          {entry.term}
          {entry.gloss && <span className="text-muted-foreground"> —— {entry.gloss}</span>}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {date && <span className="mr-2">{date}</span>}
          {t("report.dictionary.usedBy", { who: whoLabel(entry) })} · {entry.count}
        </p>
        {candidate && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <input
              value={drafts[entry.id] ?? entry.gloss}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [entry.id]: event.target.value }))
              }
              placeholder={t("report.dictionary.glossPlaceholder")}
              aria-label={t("report.dictionary.glossPlaceholder")}
              maxLength={20}
              className="rounded border border-border bg-background px-2 py-1 text-xs"
            />
            <Button
              size="sm"
              onClick={() =>
                confirm({
                  ...entry,
                  gloss: drafts[entry.id] ?? entry.gloss,
                  source: drafts[entry.id] !== undefined ? "manual" : entry.source,
                })
              }
            >
              {t("report.dictionary.confirm")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => reject(entry)}>
              {t("report.dictionary.reject")}
            </Button>
          </div>
        )}
        {first && (
          <p className="mt-1 text-xs text-muted-foreground">
            “{first.snippet}”{" "}
            {first.at && (
              <a
                className="underline underline-offset-2"
                href={`/persona/${personaId}/records?atDate=${first.at.slice(0, 10)}`}
              >
                {t("report.dictionary.openRecord")}
              </a>
            )}
          </p>
        )}
      </div>
    );
  };

  return (
    <section className="our-dictionary space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="section-title">{t("report.dictionary.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("report.dictionary.note")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          {t("report.dictionary.print")}
        </Button>
      </div>
      <div>
        <p className="kicker">{t("report.dictionary.confirmed")}</p>
        <div className="mt-1 space-y-1">
          {confirmed.map((entry) => renderEntry(entry, false))}
        </div>
      </div>
      {candidates.length > 0 && (
        <div>
          <p className="kicker">{t("report.dictionary.candidates")}</p>
          <div className="mt-1 space-y-1">
            {candidates.map((entry) => renderEntry(entry, true))}
          </div>
        </div>
      )}
    </section>
  );
}
