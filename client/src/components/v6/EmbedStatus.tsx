import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";

type EmbedProbe = "ready" | "no_ollama" | "no_model";

const STATUS_KEY: Record<EmbedProbe, "settings.ai.embedReady" | "settings.ai.embedNoOllama" | "settings.ai.embedNoModel"> = {
  ready: "settings.ai.embedReady",
  no_ollama: "settings.ai.embedNoOllama",
  no_model: "settings.ai.embedNoModel",
};

const HOW_KEY: Record<EmbedProbe, "settings.ai.embedHowReady" | "settings.ai.embedHowOllama" | "settings.ai.embedHowModel"> = {
  ready: "settings.ai.embedHowReady",
  no_ollama: "settings.ai.embedHowOllama",
  no_model: "settings.ai.embedHowModel",
};

/**
 * Whether local semantic retrieval can run.
 *
 * The three states are the ones the handbook names: Ollama is up with
 * the embedding model, Ollama is missing, or the model has not been
 * pulled. Nothing here leaves this machine.
 */
export default function EmbedStatus() {
  const { t } = useLocale();
  const status = trpc.style.embedStatus.useQuery();

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("settings.ai.embedTitle")}
        </h2>
        <p className="kicker mt-1.5">{t("settings.ai.embedNote")}</p>
      </div>
      {status.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive" role="alert">{t("common.error")}</p>
          <Button variant="ghost" size="sm" onClick={() => void status.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : status.isLoading || !status.data ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-foreground">
            <span className="rounded-md border border-border/60 px-2 py-0.5 text-xs">
              {t(STATUS_KEY[status.data.status])}
            </span>
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t(HOW_KEY[status.data.status], { model: status.data.model })}
          </p>
        </div>
      )}
    </section>
  );
}
