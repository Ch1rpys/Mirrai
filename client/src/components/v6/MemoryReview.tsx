import { Pin, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatDayKey } from "@/lib/dates";
import { toast } from "sonner";

type MemoryRow = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  subject?: string;
  date?: string | null;
  isPinned?: boolean;
  messageId?: number | null;
  factKey?: string | null;
  status?: string;
};

const CATEGORY_LABELS: Record<string, { labelKey: "chat.memory.categories.memory" | "chat.memory.categories.milestone" | "chat.memory.categories.anniversary" | "chat.memory.categories.anchor"; dot: string; chip: string }> = {
  milestone: { labelKey: "chat.memory.categories.milestone", dot: "bg-mood-playful", chip: "bg-mood-playful/10 text-mood-playful" },
  memory: { labelKey: "chat.memory.categories.memory", dot: "bg-primary", chip: "bg-primary/10 text-primary" },
  anniversary: { labelKey: "chat.memory.categories.anniversary", dot: "bg-chart-2", chip: "bg-chart-2/10 text-chart-2" },
  anchor: { labelKey: "chat.memory.categories.anchor", dot: "bg-chart-4", chip: "bg-chart-4/10 text-chart-4" },
};

const GROUPS = [
  { id: "them", titleKey: "chat.memory.groupThem" as const },
  { id: "me", titleKey: "chat.memory.groupMe" as const },
  { id: "said", titleKey: "chat.memory.groupSaid" as const },
];

function subjectOf(row: MemoryRow): "them" | "me" | "said" {
  return row.subject === "me" || row.subject === "said" ? row.subject : "them";
}

/**
 * The memory panel, grouped by whose life the row is about.
 *
 * What the persona said in chat is not a fact from the records. Those
 * rows sit in their own group until the user says one of them is true.
 */
export default function MemoryReview(props: {
  personaId: number;
  items: MemoryRow[];
  onJumpTo?: (messageId: number) => void;
  onChanged?: () => void;
  onClose?: () => void;
}) {
  const { t, locale } = useLocale();
  const confirm = useConfirm();
  const updateMutation = trpc.memory.update.useMutation({
    onSuccess: () => props.onChanged?.(),
    onError: (e: { message: string }) => toast.error(e.message),
  });
  const deleteMutation = trpc.memory.delete.useMutation({
    onSuccess: () => props.onChanged?.(),
    onError: (e: { message: string }) => toast.error(e.message),
  });
  const adjudicateMutation = trpc.memory.adjudicate.useMutation({
    onSuccess: () => props.onChanged?.(),
    onError: (e: { message: string }) => toast.error(e.message),
  });

  if (props.items.length === 0) return null;

  const pending = updateMutation.isPending || deleteMutation.isPending || adjudicateMutation.isPending;

  return (
    <div className="relative space-y-6">
      {props.items.length > 0 && <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />}
      {GROUPS.map((group) => {
        const rows = props.items.filter((row) => subjectOf(row) === group.id);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} aria-label={t(group.titleKey)}>
            <h4 className="relative pl-8 text-xs font-medium text-foreground mb-2">
              {t(group.titleKey)}
            </h4>
            {group.id === "said" && (
              <p className="relative pl-8 text-xs text-foreground/85 leading-relaxed mb-3">
                {t("chat.memory.saidHint")}
              </p>
            )}
            {rows.map((m) => {
              const cat = CATEGORY_LABELS[m.category] || CATEGORY_LABELS.memory;
              const rivals = m.factKey && m.status !== "superseded"
                ? props.items.filter((other) => other.factKey === m.factKey && other.id !== m.id && other.status !== "superseded")
                : [];
              const said = subjectOf(m) === "said";
              return (
                <div key={m.id} className="relative pl-8 pb-6 group">
                  <div className={`absolute left-1.5 top-1 w-3 h-3 rounded-full ${cat.dot} ring-2 ring-card`} />
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${cat.chip}`}>{t(cat.labelKey)}</span>
                      {m.date && (
                        <span className="text-xs text-muted-foreground ml-2">
                          {formatDayKey(m.date, locale)}
                        </span>
                      )}
                      <p className="text-sm font-medium text-foreground mt-1">{m.title}</p>
                      {m.description && <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>}
                      {m.messageId ? (
                        <button
                          type="button"
                          className="text-[11px] text-cinnabar mt-1 underline underline-offset-2"
                          onClick={() => {
                            props.onJumpTo?.(m.messageId!);
                            props.onClose?.();
                          }}
                        >
                          {t("chat.memory.source")}
                        </button>
                      ) : (
                        <p className="text-[11px] text-muted-subtle mt-1">{t("chat.memory.writtenLater")}</p>
                      )}
                      {said && (
                        <button
                          type="button"
                          className="block text-[11px] underline underline-offset-2 mt-1.5"
                          disabled={pending}
                          onClick={() => updateMutation.mutate({ id: m.id, subject: "them" })}
                        >
                          {t("chat.memory.saidIsTrue")}
                        </button>
                      )}
                      {rivals.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          <p className="text-[11px] text-muted-foreground">{t("chat.memory.conflict")}</p>
                          <button
                            type="button"
                            className="text-[11px] underline underline-offset-2"
                            disabled={adjudicateMutation.isPending}
                            onClick={() => adjudicateMutation.mutate({
                              personaId: props.personaId,
                              winnerId: m.id,
                              loserId: rivals[0].id,
                            })}
                          >
                            {t("chat.memory.keepThis")}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => updateMutation.mutate({ id: m.id, isPinned: !m.isPinned })}
                        aria-label={m.isPinned ? t("chat.memory.unpin") : t("chat.memory.pin")}
                        title={m.isPinned ? t("chat.memory.unpin") : t("chat.memory.pin")}
                        className={`opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-all ${m.isPinned ? "text-cinnabar opacity-100" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          const yes = await confirm({ description: t("chat.memory.deleteConfirm") });
                          if (!yes) return;
                          deleteMutation.mutate({ id: m.id });
                        }}
                        disabled={deleteMutation.isPending}
                        aria-label={t("chat.memory.delete")}
                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive transition-all flex-shrink-0 disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
