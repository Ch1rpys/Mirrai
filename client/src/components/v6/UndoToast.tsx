import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * The ten-second undo after a deletion (C8.11).
 *
 * Deleting a persona, a message or a memory is not the end of it: the
 * row is only hidden, and the person is offered the way back for ten
 * seconds. The bar sits at the bottom of the screen, where the eyes
 * already are after a delete, and it says what happened before it says
 * what can be done about it.
 */

/** How long the undo is offered, in milliseconds. */
export const UNDO_VISIBLE_MS = 10_000;

/** What the undo bar offers. */
export type UndoRequest = {
  /** Already translated; "已删除。" when it is not given. */
  message?: string;
  /** Already translated; "撤销" when it is not given. */
  actionLabel?: string;
  /** Puts the row back. A failure is shown in the bar. */
  onUndo: () => void | Promise<void>;
};

/**
 * The bar itself.
 *
 * It is a controlled component: the timer belongs to it, but whether it
 * is on screen belongs to whoever offered the undo.
 */
export default function UndoToast(props: {
  message?: string;
  actionLabel?: string;
  onUndo: () => void | Promise<void>;
  onClose: () => void;
  durationMs?: number;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const closed = useRef(false);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    props.onClose();
  }, [props.onClose]);

  useEffect(() => {
    const timer = setTimeout(close, props.durationMs ?? UNDO_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [close, props.durationMs]);

  const handleUndo = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await props.onUndo();
      close();
    } catch (error) {
      // The row is still in the bin, so the bar stays: the person can
      // try again before the ten seconds are up.
      setFailure((error as Error)?.message || t("errors.unknown"));
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
      className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <div className="surface flex max-w-md items-center gap-3 rounded-full border border-border px-4 py-2.5 shadow-lg">
        <span className="text-xs text-foreground">{props.message ?? t("undo.deleted")}</span>
        {failure && (
          <span className="text-xs text-destructive">{t("undo.failed", { message: failure })}</span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleUndo()}
          className="text-xs font-medium text-primary underline underline-offset-2 disabled:opacity-50"
        >
          {props.actionLabel ?? t("undo.undo")}
        </button>
      </div>
    </div>
  );
}

/**
 * The bar, with the little bit of state that decides whether it is up.
 *
 * A page adds one `showUndo` call to the delete's success handler and
 * `{undo.node}` to its JSX; the ten-second life of the bar, the failure
 * and the retry are the component's business.
 *
 * A second deletion replaces the first offer: one bar, the latest undo.
 */
export function useUndoToast(): {
  showUndo: (request: UndoRequest) => void;
  node: ReactNode;
} {
  const [request, setRequest] = useState<(UndoRequest & { key: number }) | null>(null);
  const nextKey = useRef(0);

  const showUndo = useCallback((next: UndoRequest) => {
    nextKey.current += 1;
    setRequest({ ...next, key: nextKey.current });
  }, []);
  const close = useCallback(() => setRequest(null), []);

  return {
    showUndo,
    node: request ? (
      <UndoToast
        key={request.key}
        message={request.message}
        actionLabel={request.actionLabel}
        onUndo={request.onUndo}
        onClose={close}
      />
    ) : null,
  };
}
