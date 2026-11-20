import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

/**
 * Whether a persona's replies also go to the user's own mailbox (C5.5).
 *
 * The mail server itself is set up in Settings; this only decides, per
 * relationship, whether the reply may leave the machine for it.
 */
export default function LetterEmailToggle({
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
      toast.success(t("email.switchSaved"));
      settings.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const enabled = Boolean(settings.data?.letterEmail);

  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={enabled}
        disabled={update.isPending}
        onChange={(event) =>
          update.mutate({ id: personaId, patch: { letterEmail: event.target.checked } })
        }
        className="mt-0.5"
      />
      <span>
        <span className="block">{t("email.switchLabel")}</span>
        <span className="block text-xs text-muted-foreground leading-relaxed">
          {t("email.switchHint", { name })}
        </span>
      </span>
    </label>
  );
}
