import { X } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import OutboundLetters from "@/components/OutboundLetters";

/**
 * The way-out list, reachable without going through the graduation page
 * (C3.3).
 *
 * The letters were always there, but the only door to them was the
 * farewell page — and "I never said this to them" can occur to a person
 * in the middle of an ordinary conversation. The drawer is the same list,
 * in the same words, mounted where the conversation is.
 */
export default function OutboundDrawer({
  personaId,
  name,
  open,
  onClose,
}: {
  personaId: number;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  if (!open) return null;
  const title = t("outbound.drawerTitle", { name });
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40"
      role="presentation"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-label={title}
        aria-modal="true"
        className="ml-auto flex h-full w-full max-w-lg flex-col bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <h2 className="font-display text-sm font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="app-nav-icon !h-7 !min-w-7"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4">
          <OutboundLetters personaId={personaId} name={name} />
        </div>
      </aside>
    </div>
  );
}
