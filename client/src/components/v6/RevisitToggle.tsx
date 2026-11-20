/**
 * The post-graduation revisit, switched off (C6.5).
 *
 * On day 7 and day 30 after the goodbye, the hall quietly asks whether
 * the persona still needs to be kept. It is a card, not a notification,
 * and this is where the user says they would rather not be asked at all.
 */
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

export default function RevisitToggle({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery({ id: personaId });
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => {
      toast.success(t("revisit.saved"));
      settings.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const enabled = settings.data?.revisit !== false;

  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={enabled}
        disabled={update.isPending}
        onChange={(event) =>
          update.mutate({ id: personaId, patch: { revisit: event.target.checked } })
        }
        className="mt-0.5"
      />
      <span>
        <span className="block">{t("revisit.title")}</span>
        <span className="block text-xs text-muted-foreground leading-relaxed">
          {t("revisit.note")}
        </span>
      </span>
    </label>
  );
}
