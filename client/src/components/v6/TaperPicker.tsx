import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

/**
 * The four steps down (C6.1).
 *
 * Going down is the user's own choice, one step at a time, and any step
 * can be stepped back from. Nothing here suggests a goodbye; it only
 * makes the smaller steps available, so leaving is not all-or-nothing.
 */
const STEPS = [
  { stage: 0, key: "taper.level0" },
  { stage: 1, key: "taper.level1" },
  { stage: 2, key: "taper.level2" },
  { stage: 3, key: "taper.level3" },
] as const;

export default function TaperPicker({
  personaId,
  name,
}: {
  personaId: number;
  name: string;
}) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery({ id: personaId });
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => {
      toast.success(t("taper.saved"));
      settings.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const stage = settings.data?.taper?.stage ?? 0;

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground">{t("taper.title")}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("taper.hint")}</p>
      <div className="space-y-1" role="group" aria-label={t("taper.title")}>
        {STEPS.map((step) => (
          <button
            key={step.stage}
            type="button"
            aria-pressed={stage === step.stage}
            disabled={update.isPending}
            onClick={() =>
              update.mutate({ id: personaId, patch: { taper: { stage: step.stage } } })
            }
            className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
              stage === step.stage
                ? "border-primary/50 bg-muted/40 text-foreground"
                : "border-border/70 text-muted-foreground hover:bg-muted/30"
            }`}
          >
            {t(step.key, { name })}
          </button>
        ))}
      </div>
    </div>
  );
}
