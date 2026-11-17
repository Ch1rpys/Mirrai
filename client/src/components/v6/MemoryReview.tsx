import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * Memories that were taken from what the persona said.
 *
 * Those lines are reconstructed. The user looks at each one and either
 * keeps it (the source line is dropped) or deletes it.
 */
export default function MemoryReview(props: { personaId: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const query = trpc.memory.listFromPersona.useQuery(
    { personaId: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const keep = trpc.memory.keepFromPersona.useMutation({
    onSuccess: () => {
      void query.refetch();
      void utils.memory.list.invalidate({ personaId: props.personaId });
    },
  });
  const remove = trpc.memory.delete.useMutation({
    onSuccess: () => {
      void query.refetch();
      void utils.memory.list.invalidate({ personaId: props.personaId });
    },
  });

  if (query.isError) {
    return (
      <p className="text-sm text-destructive mb-3" role="alert">
        {t("common.error")}
      </p>
    );
  }

  const rows = query.data ?? [];
  if (query.isLoading || rows.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border border-border bg-muted/30 p-3 space-y-3">
      <p className="text-xs text-foreground/85 leading-relaxed">
        {t("chat.memory.fromPersona", { count: rows.length })}
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-2">
            <p className="text-sm text-foreground min-w-0">{row.title}</p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                className="text-[11px] underline underline-offset-2"
                disabled={keep.isPending || remove.isPending}
                onClick={() => keep.mutate({ id: row.id })}
              >
                {t("chat.memory.fromPersonaKeep")}
              </button>
              <button
                type="button"
                className="text-[11px] underline underline-offset-2 text-destructive"
                disabled={keep.isPending || remove.isPending}
                onClick={() => remove.mutate({ id: row.id })}
              >
                {t("chat.memory.fromPersonaDelete")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
