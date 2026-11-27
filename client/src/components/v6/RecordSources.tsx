import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { useLocale } from "@/contexts/LocaleContext";
import { useDayKey } from "@/lib/day";

/**
 * The sources already in the record table.
 *
 * Each row is one uploaded file or one collector platform. Deleting it
 * drops the rows it brought in; the persona stays as it was until the
 * user rebuilds it.
 */
export default function RecordSources(props: { personaId: number }) {
  const { t } = useLocale();
  const day = useDayKey();
  const confirm = useConfirm();
  const sources = trpc.record.sources.useQuery(
    { personaId: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const utils = trpc.useUtils();
  const deleteFile = trpc.file.delete.useMutation({
    onSuccess: () => {
      void sources.refetch();
      void utils.persona.getSettings.invalidate({ id: props.personaId });
    },
  });
  const deleteSource = trpc.record.deleteSource.useMutation({
    onSuccess: () => {
      void sources.refetch();
      void utils.persona.getSettings.invalidate({ id: props.personaId });
    },
  });

  const rows = sources.data ?? [];
  if (rows.length === 0) return null;

  const pending = deleteFile.isPending || deleteSource.isPending;

  return (
    <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
      <h2 className="font-display text-base font-semibold text-foreground mb-2">
        {t("upload.recordSourcesTitle")}
      </h2>
      <ul>
        {rows.map((row) => {
          const key = `${row.source}:${row.fileId ?? "none"}`;
          return (
            <li
              key={key}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 border-t border-border"
            >
              <span className="text-sm text-foreground flex-1 min-w-0 truncate">{row.name}</span>
              <span className="text-xs text-muted-foreground">{row.format}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("upload.recordSourceCount", { count: row.count })}
              </span>
              {row.firstAt && row.lastAt ? (
                <span className="text-xs text-muted-foreground">
                  {t("upload.recordSourceRange", {
                    from: day(row.firstAt),
                    to: day(row.lastAt),
                  })}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">{row.status}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-md"
                disabled={pending}
                onClick={async () => {
                  const ok = await confirm({
                    description: t("upload.deleteSourceConfirm", {
                      name: row.name,
                      count: row.count,
                    }),
                    destructive: true,
                  });
                  if (!ok) return;
                  if (row.fileId != null) {
                    deleteFile.mutate({ fileId: row.fileId });
                  } else {
                    deleteSource.mutate({
                      personaId: props.personaId,
                      source: row.source,
                    });
                  }
                }}
              >
                {t("common.delete")}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
