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

  if (settings.isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (settings.isError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("common.loadFailed")}{" "}
        <button
          type="button"
          onClick={() => settings.refetch()}
          className="underline underline-offset-2"
        >
          {t("common.retry")}
        </button>
      </p>
    );
  }
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
