import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

/** The four endings (C6.6), in the order they are offered. */
export const GRADUATION_KINDS = ["farewell", "said_it", "reconciled", "not_afraid"] as const;
export type GraduationKind = (typeof GRADUATION_KINDS)[number];

/**
 * The first step of the goodbye (C6.6).
 *
 * The app used to have one ending — a farewell. Not every ending is a
 * goodbye: sometimes the thing that finished was the fear, or something
 * was finally said, or the two of them made up. The user picks; the rest
 * of the page follows.
 */
export default function GraduationKindPicker({
  personaId,
  name,
  onChosen,
}: {
  personaId: number;
  name: string;
  onChosen?: (kind: GraduationKind) => void;
}) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery({ id: personaId });
  const utils = trpc.useUtils();
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => {
      toast.success(t("graduation.kindSaved"));
      settings.refetch();
      utils.persona.get.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const current = (settings.data?.graduationKind ?? "farewell") as GraduationKind;

  return (
    <div className="space-y-3">
      <h2 className="section-title">{t("graduation.kindStepTitle")}</h2>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={t("graduation.kindStepTitle")}>
        {GRADUATION_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={current === kind}
            disabled={update.isPending}
            onClick={() => {
              update.mutate({ id: personaId, patch: { graduationKind: kind } });
              onChosen?.(kind);
            }}
            className={`text-left rounded-lg border p-3 transition-colors ${
              current === kind
                ? "border-primary/50 bg-muted/40"
                : "border-border/70 hover:bg-muted/30"
            }`}
          >
            <span className="block text-sm text-foreground">
              {t(`graduation.${kind}.title` as never, { name })}
            </span>
            <span className="block text-xs text-muted-foreground leading-relaxed mt-1">
              {t(`graduation.${kind}.note` as never, { name })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
