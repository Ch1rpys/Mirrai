import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { copy } from "@shared/copy";
import { normalizeLexicon, type LexiconEntry } from "@shared/lexicon";

/**
 * Private words, editable.
 *
 * A mined term is only a candidate until the user says it is theirs.
 * Confirming puts it in the prompt; rejecting keeps a later re-run
 * from bringing it back.
 */

let stamp = 0;
function nextId(prefix: string): string {
  stamp += 1;
  return `${prefix}-${Date.now()}-${stamp}`;
}

export default function LexiconEditor({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const lang = locale === "en" ? "en" : "zh";
  const { data, refetch, isError } = trpc.lexicon.list.useQuery({ personaId });
  const save = trpc.lexicon.save.useMutation({
    onSuccess: () => { toast.success(t("imperfection.saved")); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const mine = trpc.lexicon.mine.useMutation({
    onSuccess: (result) => {
      if (!result.entries.length) toast.info(result.hint ?? copy(lang, "labels.lexicon.minedNone"));
      else toast.success(copy(lang, "labels.lexicon.mine"));
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [term, setTerm] = useState("");
  const [gloss, setGloss] = useState("");
  const entries = normalizeLexicon(data?.entries);

  function persist(next: LexiconEntry[]) {
    save.mutate({ personaId, entries: next });
  }

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("lexicon.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("lexicon.hint")}</p>
        {data?.hint ? <p className="text-[11px] text-muted-subtle">{data.hint}</p> : null}
      </header>
      {isError ? <p className="text-xs text-destructive" role="alert">{t("common.error")}</p> : null}
      {entries.length === 0 ? (
        <p className="text-xs text-muted-subtle">{t("lexicon.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3 space-y-1.5">
              <p className="text-sm">
                <span className="font-medium">{row.term}</span>
                {row.gloss ? <span className="text-muted-foreground"> — {row.gloss}</span> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                {!row.verified ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => persist(entries.map((item) => item.id === row.id ? { ...item, verified: true } : item))}
                    >
                      {t("lexicon.confirm")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => persist(entries.filter((item) => item.id !== row.id))}
                    >
                      {t("lexicon.reject")}
                    </Button>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-subtle">{t("lexicon.verified")}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("lexicon.term")}
          maxLength={40}
        />
        <Input
          value={gloss}
          onChange={(e) => setGloss(e.target.value)}
          placeholder={t("lexicon.gloss")}
          maxLength={20}
        />
        <Button
          size="sm"
          disabled={!term.trim() || save.isPending}
          onClick={() => {
            persist([...entries, {
              id: nextId("manual"),
              term: term.trim(),
              gloss: gloss.trim().slice(0, 20),
              who: "both",
              count: 0,
              evidence: [],
              source: "manual",
              verified: true,
            }]);
            setTerm("");
            setGloss("");
          }}
        >
          {t("lexicon.add")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={mine.isPending}
          onClick={() => mine.mutate({ personaId, locale: lang })}
        >
          {t("lexicon.mine")}
        </Button>
      </div>
    </section>
  );
}
