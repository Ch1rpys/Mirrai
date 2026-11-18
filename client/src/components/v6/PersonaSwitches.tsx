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
export default function PersonaSwitches(props: { personaId: number; name: string }) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery(
    { id: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => settings.refetch(),
    onError: (error) => toast.error(error.message),
  });
  const seededTurns = settings.data?.layers?.seededTurns !== false;
  const ritualTable = settings.data?.layers?.ritualTable !== false;
  const lengthCap = settings.data?.layers?.lengthCap !== false;
  const styleProjection = settings.data?.layers?.styleProjection !== false;
  const abPairs = Boolean(settings.data?.layers?.abPairs);
  const busy = settings.isLoading || update.isPending;

  return (
    <div className="space-y-1.5">
      <p className="kicker">{t("personaEdit.switchesTitle")}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("personaEdit.switchesHint")}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={seededTurns}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { seededTurns: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.seededTurns", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.seededTurnsNote", { name: props.name })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ritualTable}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { ritualTable: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.ritualTable", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.ritualTableNote", { name: props.name })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={lengthCap}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { lengthCap: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.lengthCap", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.lengthCapNote", { name: props.name })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={styleProjection}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { styleProjection: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.styleProjection", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.styleProjectionNote", { name: props.name })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={abPairs}
          disabled={busy}
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
