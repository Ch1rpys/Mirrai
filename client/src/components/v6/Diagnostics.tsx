import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import type { Translate } from "@/i18n";
import {
  formatDiagnoseReport,
  sortDiagnoseItems,
  type DiagnoseItem,
  type DiagnoseReportLabels,
  type DiagnoseStatus,
} from "@shared/system-diagnose";
import { toast } from "sonner";

/**
 * The one-click diagnosis (C8.12), in the settings' data tab.
 *
 * One button runs every self-check the server knows how to run. The
 * results are listed problems first — red, then yellow — with one sentence
 * about how to fix each one, and the same list can be copied as plain
 * text. The report is built from the items that are on the screen, so what
 * is copied is what is read.
 *
 * One check is not the server's: the browser's own notification permission.
 * The server cannot see it, so it is added here, after the answer.
 */

/**
 * The state's word.
 *
 * Through a switch so each key stays a literal — the dictionary's types
 * allow an entry to be a list, and a list is not what a chip shows.
 */
function statusLabel(t: Translate, status: DiagnoseStatus): string {
  switch (status) {
    case "ok":
      return t("diagnostics.status.ok");
    case "warn":
      return t("diagnostics.status.warn");
    case "fail":
      return t("diagnostics.status.fail");
    case "skipped":
      return t("diagnostics.status.skipped");
  }
}

/** Red first, then yellow — a problem is easier to find at the top. */
const STATUS_TONE: Record<DiagnoseStatus, string> = {
  fail: "border-destructive/50",
  warn: "border-amber-500/50",
  ok: "border-emerald-500/40",
  skipped: "border-border",
};

const STATUS_TEXT: Record<DiagnoseStatus, string> = {
  fail: "text-destructive",
  warn: "text-amber-600 dark:text-amber-400",
  ok: "text-emerald-600 dark:text-emerald-400",
  skipped: "text-muted-foreground",
};

/** The item the client adds itself: what the browser thinks of notifications. */
function browserNotificationItem(t: Translate): DiagnoseItem {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return {
      id: "browserNotifications",
      status: "skipped",
      detail: t("diagnostics.browser.unsupported"),
      fix: t("diagnostics.browser.unsupportedFix"),
    };
  }
  if (Notification.permission === "granted") {
    return {
      id: "browserNotifications",
      status: "ok",
      detail: t("diagnostics.browser.granted"),
    };
  }
  if (Notification.permission === "denied") {
    return {
      id: "browserNotifications",
      status: "warn",
      detail: t("diagnostics.browser.denied"),
      fix: t("diagnostics.browser.deniedFix"),
    };
  }
  return {
    id: "browserNotifications",
    status: "skipped",
    detail: t("diagnostics.browser.pending"),
    fix: t("diagnostics.browser.pendingFix"),
  };
}

/**
 * Puts text on the clipboard, with a fallback for the browsers where the
 * async clipboard is missing or refused.
 *
 * A failed copy is not a crash: the report is on the screen as well, and
 * the interface says to select it by hand.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The permission was refused, or there is no clipboard. The fallback
    // below is what a browser without the asynchronous API needs anyway.
  }
  try {
    if (typeof document === "undefined" || typeof document.execCommand !== "function") {
      return false;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

export default function Diagnostics() {
  const { t } = useLocale();
  const diagnose = trpc.system.diagnose.useMutation();
  const [items, setItems] = useState<DiagnoseItem[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = sortDiagnoseItems(items ?? []);

  const reportLabels: DiagnoseReportLabels = {
    title: t("diagnostics.reportTitle"),
    status: {
      ok: t("diagnostics.status.ok"),
      warn: t("diagnostics.status.warn"),
      fail: t("diagnostics.status.fail"),
      skipped: t("diagnostics.status.skipped"),
    },
    fixPrefix: t("diagnostics.fixPrefix"),
  };
  const report = sorted.length > 0 ? formatDiagnoseReport(sorted, reportLabels) : "";

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const result = await diagnose.mutateAsync();
      /**
       * The browser's notification permission is added here rather than by
       * the server: it is a fact about this browser, and one browser is the
       * only place it can be read.
       */
      setItems([...result.items, browserNotificationItem(t)]);
    } catch (cause) {
      // A failed diagnosis is not "nothing here" — it says the check did
      // not finish, and offers to try again.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }

  async function copyReport() {
    const copied = await writeClipboard(report);
    if (copied) toast.success(t("diagnostics.copied"));
    else toast.error(t("diagnostics.copyFailed"));
  }

  return (
    <section className="surface p-5 sm:p-6" data-testid="diagnostics">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
            {t("diagnostics.title")}
          </h2>
          <p className="kicker mt-1.5">{t("diagnostics.note")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void run()}
            disabled={running}
            data-testid="diagnostics-run"
          >
            {running ? t("diagnostics.running") : t("diagnostics.run")}
          </Button>
          {items && items.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void copyReport()}
              data-testid="diagnostics-copy"
            >
              {t("diagnostics.copy")}
            </Button>
          )}
        </div>
      </div>

      {running && (
        <p className="mt-4 text-xs text-muted-foreground" data-testid="diagnostics-loading">
          {t("diagnostics.running")}
        </p>
      )}

      {!running && error && (
        <div className="mt-4 flex items-center gap-3" data-testid="diagnostics-error">
          <p className="text-xs text-destructive">
            {t("diagnostics.failed", { message: error })}
          </p>
          <button
            type="button"
            className="text-xs underline underline-offset-2"
            onClick={() => void run()}
          >
            {t("diagnostics.retry")}
          </button>
        </div>
      )}

      {!running && !error && items === null && (
        <p className="mt-4 text-xs text-muted-foreground" data-testid="diagnostics-empty">
          {t("diagnostics.empty")}
        </p>
      )}

      {sorted.length > 0 && (
        <>
          <ul className="mt-4 space-y-2">
            {sorted.map((item) => (
              <li
                key={item.id}
                data-testid="diagnostics-row"
                data-status={item.status}
                className={`rounded-md border bg-background/40 px-3 py-2 ${STATUS_TONE[item.status]}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-medium ${STATUS_TEXT[item.status]}`}>
                    {statusLabel(t, item.status)}
                  </span>
                  <code className="text-[0.65rem] text-muted-foreground">{item.id}</code>
                </div>
                <p className="mt-1 text-sm text-foreground" data-testid="diagnostics-detail">
                  {item.detail}
                </p>
                {item.fix && (
                  <p
                    className="mt-1 text-xs text-muted-foreground"
                    data-testid="diagnostics-fix"
                  >
                    {t("diagnostics.fixPrefix")}
                    {item.fix}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <details className="mt-4" data-testid="diagnostics-report-box">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {t("diagnostics.reportTitle")}
            </summary>
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">
              {t("diagnostics.reportHint")}
            </p>
            <pre
              className="mt-2 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 text-[0.6875rem] text-foreground"
              data-testid="diagnostics-report"
            >
              {report}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}

