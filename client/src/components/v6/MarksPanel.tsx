import { Star, Tag, X } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * The stars and the topics of one conversation (C8.10).
 *
 * A star is a message worth finding again; a topic is a named point the
 * user wants to return to. Both lists jump back into the transcript —
 * they are markers inside the same conversation, not a second one.
 */
export interface MarkRow {
  id: number;
  messageId: number;
  kind: string;
  label: string | null;
  content: string;
}

export default function MarksPanel({
  open,
  marks,
  onClose,
  onJump,
  onRemove,
}: {
  open: boolean;
  marks: MarkRow[];
  onClose: () => void;
  onJump: (messageId: number) => void;
  onRemove: (markId: number) => void;
}) {
  const { t } = useLocale();
  if (!open) return null;
  const stars = marks.filter((mark) => mark.kind === "star");
  const topics = marks.filter((mark) => mark.kind === "topic");

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={t("chat.marksTitle")}
        className="fixed right-3 top-16 z-50 w-[min(22rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto surface p-4 space-y-4"
      >
        <div className="flex items-center justify-between">
          <p className="font-display text-sm font-semibold text-foreground">{t("chat.marksTitle")}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="app-nav-icon !h-7 !min-w-7"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <section className="space-y-1.5">
          <p className="kicker flex items-center gap-1.5">
            <Star className="w-3 h-3" />
            {t("chat.starsTitle")}
          </p>
          {stars.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("chat.noStars")}</p>
          ) : (
            <ul className="space-y-1">
              {stars.map((mark) => (
                <li key={mark.id} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => onJump(mark.messageId)}
                    className="flex-1 min-w-0 text-left text-xs text-foreground hover:underline underline-offset-2 truncate"
                  >
                    {mark.content.replace(/\s+/g, " ").slice(0, 80)}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(mark.id)}
                    aria-label={t("chat.unstar")}
                    className="text-muted-subtle hover:text-foreground transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-1.5">
          <p className="kicker flex items-center gap-1.5">
            <Tag className="w-3 h-3" />
            {t("chat.topicsTitle")}
          </p>
          {topics.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("chat.noTopics")}</p>
          ) : (
            <ul className="space-y-1">
              {topics.map((mark) => (
                <li key={mark.id} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => onJump(mark.messageId)}
                    className="flex-1 min-w-0 text-left text-xs text-foreground hover:underline underline-offset-2"
                  >
                    <span className="font-medium">{mark.label || ""}</span>
                    <span className="ml-1.5 text-muted-foreground">
                      {mark.content.replace(/\s+/g, " ").slice(0, 40)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(mark.id)}
                    aria-label={t("chat.removeTopic")}
                    className="text-muted-subtle hover:text-foreground transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
