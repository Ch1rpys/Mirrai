import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

/**
 * The per-persona switches for the sixth stage.
 *
 * The first group costs nothing extra. The second group costs more —
 * two model calls, a wait, or the network — so it stays off until the
 * user turns it on.
 */
export default function PersonaSwitches(props: { personaId: number }) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery(
    { id: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => settings.refetch(),
    onError: (error) => toast.error(error.message),
  });
  const abPairs = Boolean(settings.data?.layers?.abPairs);

  return (
    <div className="space-y-1.5">
      <p className="kicker">{t("personaEdit.switchesTitle")}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("personaEdit.switchesHint")}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={abPairs}
          disabled={settings.isLoading || update.isPending}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { abPairs: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.abPairs")}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.abPairsNote")}
          </span>
        </span>
      </label>
    </div>
  );
}
