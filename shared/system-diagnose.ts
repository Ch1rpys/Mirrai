/**
 * One item of the one-click diagnosis (C8.12).
 *
 * The server runs the checks and says, for each one, how it went. The
 * interface lists them and the report is the same list as plain text — so
 * the two are built from one shape rather than from two descriptions of it.
 *
 * Everything in an item is meant to be read by a person and safe to paste
 * somewhere: an id, a state, one sentence about the result, and (for a
 * problem) one sentence about what to do. No secrets, no message content,
 * no names, no absolute paths. The server builds the detail and fix text
 * from a whitelist of fields; this module never has anything else to add.
 */

export const DIAGNOSE_STATUSES = ["fail", "warn", "ok", "skipped"] as const;

export type DiagnoseStatus = (typeof DIAGNOSE_STATUSES)[number];

export interface DiagnoseItem {
  /**
   * A stable name for the check, so a report can be talked about:
   * `database`, `migrations`, `provider.openai`, `channel.wechat`…
   */
  id: string;
  status: DiagnoseStatus;
  /** What the check found, in the reader's language. */
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
}

/**
 * The order the results are shown in: the problems first.
 *
 * Red, then yellow, then the ones that are fine, then the ones that were
 * not checked at all. Within a state the order the checks ran in is kept.
 */
const STATUS_RANK: Record<DiagnoseStatus, number> = {
  fail: 0,
  warn: 1,
  ok: 2,
  skipped: 3,
};

/**
 * The results, problems first.
 *
 * A stable sort, so two checks in the same state stay in the order they
 * were run — the report and the list are then the same sequence, which is
 * what makes "copy report" give exactly what is on the screen.
 */
export function sortDiagnoseItems<T extends DiagnoseItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

/** The words the report needs, so it can be written in either language. */
export interface DiagnoseReportLabels {
  title: string;
  status: Record<DiagnoseStatus, string>;
  /** The words before a fix, e.g. "How to fix: ". */
  fixPrefix: string;
}

/**
 * The results as a plain text report.
 *
 * The report is built from the whitelisted fields of `DiagnoseItem` and
 * nothing else. There is no code path here that can put a key, a message,
 * a username or a path into it: those things are not in this shape.
 *
 * The order is the same as the list's — the same `sortDiagnoseItems` — so
 * what is copied is what was read.
 */
export function formatDiagnoseReport(
  items: readonly DiagnoseItem[],
  labels: DiagnoseReportLabels,
): string {
  const lines: string[] = [labels.title];
  for (const item of sortDiagnoseItems(items)) {
    lines.push(`${labels.status[item.status]} · ${item.id} — ${item.detail}`);
    if (item.fix) lines.push(`${labels.fixPrefix}${item.fix}`);
  }
  return lines.join("\n");
}
