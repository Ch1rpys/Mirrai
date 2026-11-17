import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { useLocale } from "@/contexts/LocaleContext";

function formatTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function reasonLabel(
  reason: string,
  t: (key: "versionHistory.reasonDistill" | "versionHistory.reasonEdit" | "versionHistory.reasonCorrection" | "versionHistory.reasonRestore") => string,
): string {
  if (reason === "distill") return t("versionHistory.reasonDistill");
  if (reason === "edit") return t("versionHistory.reasonEdit");
  if (reason === "correction") return t("versionHistory.reasonCorrection");
  if (reason === "restore") return t("versionHistory.reasonRestore");
  return reason;
}

/**
 * The snapshots of this persona.
 *
 * Distillation, a full edit, a correction, and a restore each store
 * one. Restore asks first: the current persona is stored, so the
 * change can be undone.
 */
export default function VersionHistory(props: { personaId: number }) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = trpc.personaVersion.list.useQuery(
    { id: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const diff = trpc.personaVersion.diff.useQuery(
    { id: props.personaId, versionId: selectedId ?? 0 },
    { enabled: props.personaId > 0 && selectedId != null },
  );
  const restore = trpc.personaVersion.restore.useMutation({
    onSuccess: () => {
      void list.refetch();
      setSelectedId(null);
    },
  });

  const versions = list.data?.versions ?? [];
  if (versions.length === 0) return null;

  return (
    <section className="surface p-5 sm:p-6 space-y-4 animate-fade-in-up">
      <h2 className="section-title">{t("versionHistory.title")}</h2>
      <ul>
        {versions.map((row) => {
          const time = formatTime(row.createdAt);
          const selected = selectedId === row.id;
          return (
            <li key={row.id} className="py-3 border-t border-border space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <button
                  type="button"
                  className="text-sm text-foreground text-left"
                  onClick={() => setSelectedId(selected ? null : row.id)}
                >
                  {time}
                  <span className="text-muted-foreground"> · </span>
                  <span>{reasonLabel(row.reason, t)}</span>
                </button>
                {row.overlap != null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("versionHistory.overlap", { value: row.overlap.toFixed(2) })}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-md ml-auto"
                  disabled={restore.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      description: t("versionHistory.restoreConfirm", { time }),
                    });
                    if (!ok) return;
                    restore.mutate({ id: props.personaId, versionId: row.id });
                  }}
                >
                  {t("versionHistory.restore")}
                </Button>
              </div>
              {selected && diff.data ? (
                <p className="text-xs text-muted-foreground">
                  {t("versionHistory.compare")}: {t("versionHistory.before")}{" "}
                  {diff.data.prose.speakingStyle.before ?? ""} · {t("versionHistory.after")}{" "}
                  {diff.data.prose.speakingStyle.after ?? ""}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
