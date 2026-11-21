import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatInstantInZone } from "@/lib/dates";
import { toast } from "sonner";

type DeletedPersona = {
  id: number;
  name: string;
  avatarUrl: string | null;
  relationshipDesc?: string | null;
  chatCount?: number;
  deletedAt: string | Date | null;
};

/**
 * The recycle bin, in the settings' data tab (C8.11).
 *
 * A deleted persona is not gone for thirty days. This is where it waits:
 * the person can take it back, or clear it now without waiting.
 *
 * The three states a read can be in are all said: still loading, failed
 * with a way to try again, and empty — an empty bin is not an error and
 * must not look like one.
 */
export default function RecycleBin() {
  const { t, locale } = useLocale();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.persona.listDeleted.useQuery();
  const restore = trpc.persona.restore.useMutation({
    onSuccess: () => {
      toast.success(t("recycle.restored"));
      void utils.persona.listDeleted.invalidate();
      // The lobby gains the persona back.
      void utils.persona.list.invalidate();
    },
    onError: (error) => toast.error(t("recycle.restoreFailed", { message: error.message })),
  });
  const purge = trpc.persona.purge.useMutation({
    onSuccess: () => {
      toast.success(t("recycle.purged"));
      void utils.persona.listDeleted.invalidate();
    },
    onError: (error) => toast.error(t("recycle.actionFailed", { message: error.message })),
  });

  const rows: DeletedPersona[] = data?.personas ?? [];

  const askPurge = async (persona: DeletedPersona) => {
    const yes = await confirm({
      title: t("recycle.title"),
      description: t("recycle.purgeConfirm", { name: persona.name }),
      confirmLabel: t("recycle.purge"),
      destructive: true,
    });
    if (!yes) return;
    purge.mutate({ id: persona.id });
  };

  return (
    <section className="surface p-5 sm:p-6" data-testid="recycle-bin">
      <h3 className="font-serif text-base text-foreground">{t("recycle.title")}</h3>
      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{t("recycle.hint")}</p>

      {isLoading && (
        <p className="mt-4 text-xs text-muted-foreground">{t("recycle.loading")}</p>
      )}

      {!isLoading && isError && (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-xs text-destructive">{t("recycle.loadFailed")}</p>
          <button
            type="button"
            className="text-xs underline underline-offset-2"
            onClick={() => void refetch()}
          >
            {t("recycle.retry")}
          </button>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="mt-4 text-xs text-muted-foreground">{t("recycle.empty")}</p>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rows.map((persona) => (
            <li
              key={persona.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              data-testid="recycle-row"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{persona.name}</p>
                <p className="text-[0.6875rem] text-muted-foreground">
                  {t("recycle.deletedAt", {
                    date: formatInstantInZone(persona.deletedAt, locale),
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={restore.isPending || purge.isPending}
                  className="text-xs underline underline-offset-2 disabled:opacity-50"
                  onClick={() => restore.mutate({ id: persona.id })}
                >
                  {t("recycle.restore")}
                </button>
                <button
                  type="button"
                  disabled={restore.isPending || purge.isPending}
                  className="text-xs text-destructive underline underline-offset-2 disabled:opacity-50"
                  onClick={() => void askPurge(persona)}
                >
                  {t("recycle.purge")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
