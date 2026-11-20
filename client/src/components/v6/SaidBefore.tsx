import { useState } from "react";
import { History } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * "Did they ever say this?" (C2.3)
 *
 * The panel answers per sentence. A line with a date is a real line
 * from the record; the footer says so, because the rest of the bubble
 * was written by a model.
 */
export default function SaidBefore({
  personaId,
  text,
  name,
}: {
  personaId: number;
  text: string;
  name: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const checked = trpc.record.nearest.useQuery(
    { personaId, text },
    { enabled: open },
  );

  const label = t("chat.saidBefore", { name });

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        className="text-muted-subtle hover:text-muted-foreground transition-colors p-0.5"
      >
        <History className="w-3 h-3" />
      </button>
      {open && (
        <span
          role="dialog"
          aria-label={label}
          className="absolute bottom-full right-0 z-20 mb-1 block w-[min(22rem,80vw)] rounded-md border border-border bg-card p-2 text-left shadow-md"
        >
          {checked.isLoading && (
            <span className="block px-1 py-1 text-xs text-muted-foreground">
              {t("chat.saidBefore", { name })}
            </span>
          )}
          {checked.isError && (
            <span className="block px-1 py-1 text-xs text-destructive" role="alert">
              {t("chat.saidFailed")}
            </span>
          )}
          {checked.data?.map((sentence) => (
            <span key={sentence.text} className="block border-b border-border/50 px-1 py-1.5 last:border-0">
              <span className="block text-sm text-foreground">{sentence.text}</span>
              <span className="block text-[11px] text-muted-foreground">
                {sentence.verdict === "verbatim"
                  ? t("chat.saidVerbatim")
                  : sentence.verdict === "similar"
                    ? t("chat.saidSimilar")
                    : t("chat.saidNone")}
              </span>
              {sentence.matches.map((match) => (
                <span key={match.id} className="mt-0.5 block text-xs text-muted-foreground">
                  {match.content}
                  {match.at && <span className="ml-1 opacity-70">{match.at.slice(0, 10)}</span>}
                  <a
                    href={`/persona/${personaId}/records?at=${match.id}`}
                    className="ml-1 underline"
                  >
                    {t("chat.saidOpen")}
                  </a>
                </span>
              ))}
            </span>
          ))}
          <span className="mt-1 block border-t border-border/60 px-1 pt-1 text-[11px] leading-relaxed text-muted-foreground">
            {t("chat.saidFooter", { name })}
          </span>
        </span>
      )}
    </span>
  );
}
