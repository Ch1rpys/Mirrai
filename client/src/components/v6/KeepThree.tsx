import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface KeptQuote {
  recordId: number;
  text: string;
  at?: string;
}

/**
 * Choosing three real lines to keep (C6.4).
 *
 * The farewell letter is rebuilt; these three are things the persona
 * actually said, picked by the user from the records. The server reads
 * every id and takes the words and the date from the record, so what is
 * kept is never something the client typed.
 */
export default function KeepThree({
  personaId,
  name,
  onDone,
}: {
  personaId: number;
  name: string;
  onDone?: () => void;
}) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery({ id: personaId });
  const marks = trpc.record.marks.list.useQuery({ personaId });
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const search = trpc.record.search.useQuery(
    { personaId, q: submitted, role: "assistant" },
    { enabled: submitted.length > 0 },
  );
  const searched = submitted.length > 0;
  const save = trpc.persona.setKeptQuotes.useMutation({
    onSuccess: () => {
      toast.success(t("keepThree.saved"));
      settings.refetch();
      onDone?.();
    },
    onError: (error) => toast.error(error.message),
  });
  const [chosen, setChosen] = useState<KeptQuote[]>([]);
  /**
   * The saved quotes are read once, when the settings arrive.
   *
   * The query answers with a fresh array each render; depending on it
   * directly made the effect set state on every render, and the page
   * never settled.
   */
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    const stored = settings.data?.keptQuotes;
    if (!Array.isArray(stored)) return;
    loaded.current = true;
    setChosen(stored.map((quote) => ({ recordId: quote.recordId, text: quote.text, at: quote.at })));
  }, [settings.data?.keptQuotes]);

  const results = (search.data?.exact ?? []) as Array<{
    id: number;
    content: string;
    timestamp: string | null;
  }>;
  const bookmarks = (marks.data ?? []).filter(
    (mark) => mark.kind === "bookmark" && mark.content,
  );
  const isChosen = (recordId: number) => chosen.some((quote) => quote.recordId === recordId);

  function add(quote: KeptQuote) {
    if (isChosen(quote.recordId)) return;
    if (chosen.length >= 3) return;
    setChosen((current) => [...current, quote]);
  }

  function remove(recordId: number) {
    setChosen((current) => current.filter((quote) => quote.recordId !== recordId));
  }

  if (settings.isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (settings.isError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("keepThree.loadFailed")}{" "}
        <button type="button" onClick={() => settings.refetch()} className="underline underline-offset-2">
          {t("common.retry")}
        </button>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="section-title">{t("keepThree.title")}</h2>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t("keepThree.hint", { name })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("keepThree.searchPlaceholder")}
          className="w-64"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={query.trim().length === 0}
          onClick={() => setSubmitted(query.trim())}
        >
          {t("keepThree.search")}
        </Button>
      </div>
      {searched && search.isError && (
        <p className="text-xs text-muted-foreground">
          {t("keepThree.searchFailed")}{" "}
          <button type="button" onClick={() => search.refetch()} className="underline underline-offset-2">
            {t("common.retry")}
          </button>
        </p>
      )}
      {searched && !search.isError && results.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("keepThree.noResults")}</p>
      )}
      {results.length > 0 && (
        <ul className="space-y-1.5">
          {results.map((hit) => (
            <li key={hit.id} className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
              <span className="flex-1 text-sm whitespace-pre-wrap break-words">{hit.content}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={isChosen(hit.id) || chosen.length >= 3}
                onClick={() => add({ recordId: hit.id, text: hit.content, at: hit.timestamp ?? undefined })}
              >
                {isChosen(hit.id) ? t("keepThree.chosenOne") : t("keepThree.choose")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {bookmarks.length > 0 && (
        <div className="space-y-1.5">
          <p className="kicker">{t("keepThree.fromBookmarks")}</p>
          <ul className="space-y-1.5">
            {bookmarks.map((mark) => (
              <li key={mark.id} className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                <span className="flex-1 text-sm whitespace-pre-wrap break-words">{mark.content}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isChosen(mark.recordId) || chosen.length >= 3}
                  onClick={() =>
                    add({
                      recordId: mark.recordId,
                      text: String(mark.content),
                      at: mark.timestamp ?? undefined,
                    })
                  }
                >
                  {isChosen(mark.recordId) ? t("keepThree.chosenOne") : t("keepThree.choose")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1.5">
        <p className="kicker">{t("keepThree.chosen", { n: chosen.length })}</p>
        {chosen.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("keepThree.empty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {chosen.map((quote) => (
              <li key={quote.recordId} className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                <span className="flex-1 text-sm whitespace-pre-wrap break-words">{quote.text}</span>
                <Button size="sm" variant="ghost" onClick={() => remove(quote.recordId)}>
                  {t("keepThree.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={save.isPending || chosen.length === 0 || chosen.length > 3}
          onClick={() =>
            save.mutate({ personaId, recordIds: chosen.map((quote) => quote.recordId) })
          }
        >
          {t("keepThree.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone?.()}>
          {t("keepThree.skip")}
        </Button>
      </div>
    </div>
  );
}
