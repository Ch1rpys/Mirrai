import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

const EXTRA_BODY_MAX_BYTES = 2048;

/**
 * Private OpenAI-compatible fields on the default configuration.
 *
 * The JSON is stored as-is and merged into the request. A mistake
 * here makes the request fail, so the box checks the shape first.
 */
export default function ExtraBodyEditor() {
  const { t } = useLocale();
  const defaultConfig = trpc.llmConfig.getDefault.useQuery();
  const update = trpc.llmConfig.updateExtraConfig.useMutation({
    onSuccess: () => {
      toast.success(t("settings.ai.extraBodySaved"));
      defaultConfig.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const extraBody = (defaultConfig.data?.extraConfig as { extraBody?: unknown } | undefined)?.extraBody;
    setText(extraBody && typeof extraBody === "object" ? JSON.stringify(extraBody, null, 2) : "");
  }, [defaultConfig.data]);

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("settings.ai.extraBodyTitle")}
        </h2>
        <p className="kicker mt-1.5">{t("settings.ai.extraBodyNote")}</p>
      </div>
      <div className="space-y-3">
        <Textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setHint(null);
          }}
          placeholder={t("settings.ai.extraBodyPlaceholder")}
          rows={6}
          disabled={!defaultConfig.data}
          className="font-mono text-xs"
        />
        {hint ? (
          <p className="text-xs text-destructive" role="alert">{hint}</p>
        ) : null}
        <Button
          size="sm"
          className="rounded-md px-5"
          disabled={!defaultConfig.data || update.isPending}
          onClick={() => {
            const trimmed = text.trim();
            if (!trimmed) {
              update.mutate({ extraConfig: { extraBody: {} } });
              return;
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(trimmed);
            } catch {
              setHint(t("settings.ai.extraBodyInvalid"));
              return;
            }
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              setHint(t("settings.ai.extraBodyInvalid"));
              return;
            }
            if (JSON.stringify(parsed).length > EXTRA_BODY_MAX_BYTES) {
              setHint(t("settings.ai.extraBodyTooLarge"));
              return;
            }
            update.mutate({ extraConfig: { extraBody: parsed as Record<string, unknown> } });
          }}
        >
          {update.isPending ? t("common.saving") : t("settings.ai.saveExtraBody")}
        </Button>
      </div>
    </section>
  );
}
