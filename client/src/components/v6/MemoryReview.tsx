import { useState } from "react";
import { ImagePlus, Pin, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatDayKey } from "@/lib/dates";
import { toast } from "sonner";
import { useUndoToast } from "@/components/v6/UndoToast";

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
  media?: Array<{
    id: number;
    url: string;
    at: Date | string | null;
    width?: number | null;
    height?: number | null;
  }>;
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
  /**
   * The undo of a memory deletion (C8.11).
   *
   * A memory goes to the bin, and the bar at the bottom offers the way
   * back for ten seconds; the panel is told when it comes back.
   */
  const undo = useUndoToast();
  const restoreMutation = trpc.memory.restore.useMutation();
  const deleteMutation = trpc.memory.delete.useMutation({
    onSuccess: (_data, variables) => {
      props.onChanged?.();
      undo.showUndo({
        onUndo: async () => {
          await restoreMutation.mutateAsync({ id: variables.id });
          props.onChanged?.();
        },
      });
    },
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
                      <MemoryPhotos
                        memory={m}
                        onChanged={props.onChanged}
                      />
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

      {undo.node}
    </div>
  );
}


/**
 * A photo attached to a memory (B7.8).
 *
 * The suggestion is only a suggestion: the user picks the photo. A
 * memory without a photo shows one quiet button and nothing else, so
 * the panel does not turn into an album by itself.
 */
function MemoryPhotos({
  memory,
  onChanged,
}: {
  memory: MemoryRow;
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const [picking, setPicking] = useState(false);
  const suggest = trpc.memory.suggestMedia.useQuery(
    { memoryId: memory.id },
    { enabled: picking },
  );
  const link = trpc.memory.linkMedia.useMutation({
    onSuccess: () => {
      setPicking(false);
      onChanged?.();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const unlink = trpc.memory.unlinkMedia.useMutation({
    onSuccess: () => onChanged?.(),
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const photos = memory.media ?? [];

  return (
    <div className="mt-1.5">
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {photos.map((photo) => (
            <span key={photo.id} className="relative inline-block group/photo">
              <a
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                title={t("memoryPhoto.attached")}
                className="block w-14 h-14 overflow-hidden rounded-sm border border-border/60"
              >
                <img src={photo.url} alt="" className="w-full h-full object-cover" />
              </a>
              <button
                type="button"
                title={t("memoryPhoto.remove")}
                aria-label={t("memoryPhoto.remove")}
                disabled={unlink.isPending}
                onClick={() => unlink.mutate({ memoryId: memory.id, mediaId: photo.id })}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-background border border-border p-0.5 opacity-100 md:opacity-0 md:group-hover/photo:opacity-100 focus-visible:opacity-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {picking ? (
        <div className="mt-1.5 space-y-1.5">
          {suggest.isLoading && (
            <p className="text-[11px] text-muted-subtle">{t("common.loading")}</p>
          )}
          {suggest.isError && (
            <p className="text-[11px] text-muted-subtle">
              {t("memoryPhoto.failed")}{" "}
              <button type="button" className="underline" onClick={() => suggest.refetch()}>
                {t("common.retry")}
              </button>
            </p>
          )}
          {suggest.data && suggest.data.photos.length === 0 && (
            <p className="text-[11px] text-muted-subtle">{t("memoryPhoto.empty")}</p>
          )}
          {suggest.data && suggest.data.photos.length > 0 && (
            <>
              <p className="text-[11px] text-muted-subtle">{t("memoryPhoto.suggestHint")}</p>
              <div className="flex flex-wrap gap-1.5">
                {suggest.data.photos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    className="w-14 h-14 overflow-hidden rounded-sm border border-border/60 hover:border-primary transition-colors"
                    aria-label={t("memoryPhoto.pick")}
                    disabled={link.isPending}
                    onClick={() => link.mutate({ memoryId: memory.id, mediaId: photo.id })}
                  >
                    <img src={photo.url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline underline-offset-2"
            onClick={() => setPicking(false)}
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline underline-offset-2 inline-flex items-center gap-1"
          onClick={() => setPicking(true)}
        >
          <ImagePlus className="w-3 h-3" />
          {photos.length > 0 ? t("memoryPhoto.change") : t("memoryPhoto.attach")}
        </button>
      )}
    </div>
  );
}
