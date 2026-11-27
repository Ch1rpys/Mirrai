/**
 * The two request fields that only some model services understand (B9.3).
 *
 * `logit_bias` needs OpenAI's token ids, and `grammar` is llama.cpp's
 * GBNF. Sending either to a service that does not understand it makes the
 * request fail, so both are off by default away from the official OpenAI
 * address, and the user opens them here once, for their own endpoint.
 *
 * The server sends the *effective* value back — the official address
 * supports `logit_bias` without any stored flag — so the boxes show what
 * the app will actually do, not what happens to be written down.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

export default function StructuredOutputSettings() {
  const { t } = useLocale();
  const defaultConfig = trpc.llmConfig.getDefault.useQuery();
  const update = trpc.llmConfig.updateExtraConfig.useMutation({
    onSuccess: () => {
      toast.success(t("settings.ai.structuredOutputSaved"));
      defaultConfig.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const data = defaultConfig.data as
    | { supportsLogitBias?: boolean; supportsGrammar?: boolean }
    | null
    | undefined;
  const [logitBias, setLogitBias] = useState(false);
  const [grammar, setGrammar] = useState(false);

  useEffect(() => {
    if (!data) return;
    setLogitBias(Boolean(data.supportsLogitBias));
    setGrammar(Boolean(data.supportsGrammar));
  }, [data?.supportsLogitBias, data?.supportsGrammar]);

  function save(patch: Record<string, boolean>) {
    update.mutate({ extraConfig: patch });
  }

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("settings.ai.structuredOutputTitle")}
        </h2>
        <p className="kicker mt-1.5">{t("settings.ai.structuredOutputNote")}</p>
      </div>
      {defaultConfig.isLoading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : defaultConfig.isError ? (
        <p className="text-xs text-muted-foreground">
          {t("common.loadFailed")}{" "}
          <button
            type="button"
            onClick={() => defaultConfig.refetch()}
            className="underline underline-offset-2"
          >
            {t("common.retry")}
          </button>
        </p>
      ) : !data ? null : (
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={logitBias}
              disabled={update.isPending}
              onChange={(event) => {
                const checked = event.target.checked;
                setLogitBias(checked);
                save({ supportsLogitBias: checked });
              }}
              className="mt-0.5"
            />
            <span>
              <span className="block">{t("settings.ai.structuredOutputLogitBias")}</span>
              <span className="block text-xs text-muted-foreground leading-relaxed">
                {t("settings.ai.structuredOutputLogitBiasNote")}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={grammar}
              disabled={update.isPending}
              onChange={(event) => {
                const checked = event.target.checked;
                setGrammar(checked);
                save({ supportsGrammar: checked });
              }}
              className="mt-0.5"
            />
            <span>
              <span className="block">{t("settings.ai.structuredOutputGrammar")}</span>
              <span className="block text-xs text-muted-foreground leading-relaxed">
                {t("settings.ai.structuredOutputGrammarNote")}
              </span>
            </span>
          </label>
        </div>
      )}
    </section>
  );
}
