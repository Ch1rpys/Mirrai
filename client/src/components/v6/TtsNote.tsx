import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * Where the read-aloud runs, said plainly.
 *
 * The copy used to say "the text of the reply is sent to Microsoft" —
 * which was true when Edge was the only engine and false the moment a
 * local engine is configured. It reads the engine from the server and
 * says the true one: nothing is claimed before the answer arrives.
 */
export default function TtsNote() {
  const { t, locale } = useLocale();
  const { data } = trpc.chat.voices.useQuery(
    { locale: locale === "en" ? "en" : "zh" },
    { staleTime: 60_000 },
  );

  // Until the engine is known, say nothing rather than the wrong thing.
  if (!data) return null;

  const body = !data.enabled
    ? t("localFirst.ttsOffNote")
    : data.leavesMachine
      ? t("localFirst.ttsNote")
      : t("localFirst.ttsLocalNote");

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
      <p className="text-xs font-medium text-foreground/80 mb-1.5">
        {t("localFirst.ttsTitle")}
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
