import { useState } from "react";
import { ChevronDown, ChevronUp, Pin, X } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * The few messages the user keeps in front of them (C8.10).
 *
 * A narrow band above the conversation, folded away by default. It is a
 * memory aid, not a second conversation: clicking one jumps to it in the
 * transcript, and taking the pin off is one click.
 */
export interface PinnedMark {
  id: number;
  messageId: number;
  content: string;
  label?: string | null;
}

export default function PinnedBand({
  marks,
  onJump,
  onUnpin,
}: {
  marks: PinnedMark[];
  onJump: (messageId: number) => void;
  onUnpin: (markId: number) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  if (marks.length === 0) return null;

  return (
    <div className="flex-shrink-0" data-testid="pinned-band">
      <div className="container max-w-2xl mx-auto px-4">
        <div className="mb-1.5 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pin className="w-3 h-3" />
            <span className="flex-1 text-left">
              {t("chat.pinnedTitle")}（{marks.length}）
            </span>
            {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span className="text-[0.6875rem]">
              {open ? t("chat.pinnedHide") : t("chat.pinnedShow")}
            </span>
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1">
              {marks.map((mark) => (
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
                    onClick={() => onUnpin(mark.id)}
                    aria-label={t("chat.unpin")}
                    className="text-muted-subtle hover:text-foreground transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
