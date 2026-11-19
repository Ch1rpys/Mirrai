import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { formatMinuteOfDay, normalizeRoutine } from "@shared/routine-profile";
import { normalizeDoubleText } from "@shared/double-text";

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
  const styleReminder = settings.data?.layers?.styleReminder !== false;
  const lengthCap = settings.data?.layers?.lengthCap !== false;
  const styleProjection = settings.data?.layers?.styleProjection !== false;
  const actClusters = settings.data?.layers?.actClusters !== false;
  const emotionInertia = settings.data?.layers?.emotionInertia !== false;
  const closing = settings.data?.layers?.closing !== false;
  const stickers = settings.data?.layers?.stickers !== false;
  const factAnnotate = settings.data?.layers?.factAnnotate !== false;
  const abPairs = Boolean(settings.data?.layers?.abPairs);
  const twoStage = Boolean(settings.data?.layers?.twoStage);
  const factRewrite = Boolean(settings.data?.layers?.factRewrite);
  const asyncDelivery = Boolean(settings.data?.timing?.asyncDelivery);
  const maxDelayMinutes = settings.data?.timing?.maxDelayMinutes ?? 30;
  const asleep = Boolean(settings.data?.timing?.sleep);
  const followUp = Boolean(settings.data?.timing?.followUp);
  const recall = Boolean(settings.data?.timing?.recall);
  const style = trpc.style.get.useQuery(
    { personaId: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const sleepWindow = normalizeRoutine(style.data?.profile?.routine)?.sleep;
  const sleepStart = sleepWindow ? formatMinuteOfDay(sleepWindow.startMin) : "—";
  const sleepEnd = sleepWindow ? formatMinuteOfDay(sleepWindow.endMin) : "—";
  const doubleText = normalizeDoubleText(style.data?.profile?.doubleText);
  const followExample = doubleText?.lines[0]?.text ?? "—";
  const followSamples = doubleText?.samples ?? 0;
  const followOpportunities = doubleText?.opportunities ?? 0;
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
          checked={styleReminder}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { styleReminder: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.styleReminder")}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.styleReminderNote", { name: props.name })}
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
          checked={actClusters}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { actClusters: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.actClusters", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.actClustersNote", { name: props.name })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={emotionInertia}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { emotionInertia: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.emotionInertia", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.emotionInertiaNote", { name: props.name })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={closing}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { closing: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.closing", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.closingNote", { name: props.name })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={stickers}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { stickers: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.stickers", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.stickersNote", { name: props.name })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={factAnnotate}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { factAnnotate: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.factAnnotate")}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.factAnnotateNote")}
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
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={twoStage}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { twoStage: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.twoStage", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.twoStageNote")}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={factRewrite}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { layers: { factRewrite: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.factRewrite")}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.factRewriteNote")}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={asyncDelivery}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { timing: { asyncDelivery: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.asyncDelivery", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.asyncDeliveryNote", { name: props.name })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <span className="flex-1">
          <span className="block">{t("personaEdit.maxDelayMinutes")}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.maxDelayMinutesNote")}
          </span>
        </span>
        <input
          type="number"
          min={1}
          max={360}
          value={maxDelayMinutes}
          disabled={busy || !asyncDelivery}
          aria-label={t("personaEdit.maxDelayMinutes")}
          onChange={(event) => {
            const n = Number.parseInt(event.target.value, 10);
            if (!Number.isFinite(n)) return;
            update.mutate({
              id: props.personaId,
              patch: { timing: { maxDelayMinutes: n } },
            });
          }}
          className="mt-0.5 w-16 rounded-md border border-input bg-background px-2 py-1 text-sm"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={asleep}
          disabled={busy || !asyncDelivery}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { timing: { sleep: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.sleep", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.sleepNote", { name: props.name, start: sleepStart, end: sleepEnd })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={followUp}
          disabled={busy || !asyncDelivery}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { timing: { followUp: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.followUp", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.followUpNote", {
              name: props.name,
              opportunities: followOpportunities,
              samples: followSamples,
              example: followExample,
            })}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={recall}
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              id: props.personaId,
              patch: { timing: { recall: event.target.checked } },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("personaEdit.recall", { name: props.name })}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("personaEdit.recallNote", { name: props.name })}
          </span>
        </span>
      </label>
    </div>
  );
}
