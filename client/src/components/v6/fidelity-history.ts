/**
 * The numbers a history panel can plot without asking the server again.
 *
 * Eval runs arrive newest-first and loosely typed. The curve wants
 * oldest-first points with an interval on every measure; the comparison
 * wants the two persona versions that bound the last distillation.
 */

export type HistoryRun = {
  id: number;
  createdAt: Date | string;
  metricsJson: unknown;
};

export type HistoryVersion = {
  id: number;
  reason: string;
  createdAt: string;
  evalRunId?: number | null;
};

export type HistoryInterval = {
  value: number;
  lo: number;
  hi: number;
};

export type HistoryPoint = {
  runId: number;
  at: number;
  overlap: HistoryInterval;
  likelihoodGap: HistoryInterval;
  style: HistoryInterval;
  auc: HistoryInterval | null;
};

export type CompareColumn = {
  versionId: number;
  reason: string;
  createdAt: string;
  role: "before" | "after" | "version";
  runId: number | null;
  point: HistoryPoint | null;
};

export type AblationRowView = {
  layer: string;
  overlap: number;
  likelihoodGap: number;
  styleDistance: number;
  actMatch: number;
  verdict: string;
};

export type NoiseVerdict = "better" | "worse" | "within noise";

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function timeOf(value: Date | string | number | null | undefined): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

function intervalOf(value: number, pair: unknown): HistoryInterval {
  if (Array.isArray(pair) && pair.length >= 2) {
    const lo = num(pair[0]);
    const hi = num(pair[1]);
    if (lo != null && hi != null) return { value, lo, hi };
  }
  return { value, lo: value, hi: value };
}

function curveVariant(metrics: Record<string, unknown>): boolean {
  const variant = metrics.variant;
  return variant !== "ablate" && variant !== "drift" && variant !== "audition";
}

export function pointFromRun(run: HistoryRun): HistoryPoint | null {
  const metrics = asRecord(run.metricsJson);
  if (!metrics || !curveVariant(metrics)) return null;
  const overlap = num(metrics.overlap);
  const likelihoodGap = num(metrics.likelihoodGap);
  if (overlap == null || likelihoodGap == null) return null;
  const styleRecord = asRecord(metrics.styleDistance);
  const styleValue = num(styleRecord?.total) ?? 0;
  const ci = asRecord(metrics.ci);
  const discriminator = asRecord(metrics.discriminator);
  const auc = num(discriminator?.auc);
  const aucStd = num(discriminator?.aucStd);
  return {
    runId: run.id,
    at: timeOf(run.createdAt),
    overlap: intervalOf(overlap, ci?.overlap),
    likelihoodGap: intervalOf(likelihoodGap, ci?.likelihoodGap),
    style: intervalOf(styleValue, ci?.styleDistance),
    auc:
      auc == null
        ? null
        : {
            value: auc,
            lo: aucStd == null ? auc : auc - aucStd,
            hi: aucStd == null ? auc : auc + aucStd,
          },
  };
}

export function historyPointsFromRuns(runs: HistoryRun[]): HistoryPoint[] {
  return runs
    .map(pointFromRun)
    .filter((point): point is HistoryPoint => point != null)
    .sort((a, b) => a.at - b.at || a.runId - b.runId);
}

function newestOnOrAfter(points: HistoryPoint[], at: number): HistoryPoint | null {
  const later = points.filter((point) => point.at >= at);
  if (later.length === 0) return null;
  return later.reduce((best, point) => (point.at < best.at ? point : best));
}

function newestBefore(points: HistoryPoint[], at: number): HistoryPoint | null {
  const earlier = points.filter((point) => point.at < at);
  if (earlier.length === 0) return null;
  return earlier.reduce((best, point) => (point.at > best.at ? point : best));
}

function pointByRunId(points: HistoryPoint[], runId: number | null | undefined): HistoryPoint | null {
  if (runId == null) return null;
  return points.find((point) => point.runId === runId) ?? null;
}

/**
 * Two columns: the last distillation's before and after, or the last
 * two persona versions when there was no distillation.
 */
export function compareColumnsFromVersions(
  versions: HistoryVersion[],
  runs: HistoryRun[],
): CompareColumn[] {
  const points = historyPointsFromRuns(runs);
  const ordered = [...versions].sort(
    (a, b) => timeOf(a.createdAt) - timeOf(b.createdAt) || a.id - b.id,
  );
  const distill = [...ordered].reverse().find((row) => row.reason === "distill");
  if (distill) {
    const at = timeOf(distill.createdAt);
    const after =
      pointByRunId(points, distill.evalRunId) ?? newestOnOrAfter(points, at);
    const before = newestBefore(points, at);
    const previous = ordered.filter((row) => timeOf(row.createdAt) < at).at(-1);
    return [
      {
        versionId: previous?.id ?? 0,
        reason: previous?.reason ?? "before",
        createdAt: previous?.createdAt ?? "",
        role: "before",
        runId: before?.runId ?? null,
        point: before,
      },
      {
        versionId: distill.id,
        reason: distill.reason,
        createdAt: distill.createdAt,
        role: "after",
        runId: after?.runId ?? null,
        point: after,
      },
    ];
  }
  if (ordered.length < 2) return [];
  return ordered.slice(-2).map((row) => {
    const at = timeOf(row.createdAt);
    const point = pointByRunId(points, row.evalRunId) ?? newestOnOrAfter(points, at);
    return {
      versionId: row.id,
      reason: row.reason,
      createdAt: row.createdAt,
      role: "version" as const,
      runId: point?.runId ?? null,
      point,
    };
  });
}

export function latestAblationFromRuns(runs: HistoryRun[]): AblationRowView[] | null {
  const newestFirst = [...runs].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt) || b.id - a.id);
  for (const run of newestFirst) {
    const metrics = asRecord(run.metricsJson);
    if (!metrics || metrics.variant !== "ablate" || !Array.isArray(metrics.layers)) continue;
    const rows = metrics.layers.flatMap((item) => {
      const row = asRecord(item);
      if (!row || typeof row.layer !== "string") return [];
      return [
        {
          layer: row.layer,
          overlap: num(row.overlap) ?? 0,
          likelihoodGap: num(row.likelihoodGap) ?? 0,
          styleDistance: num(row.styleDistance) ?? 0,
          actMatch: num(row.actMatch) ?? 0,
          verdict: typeof row.verdict === "string" ? row.verdict : "",
        },
      ];
    });
    return rows;
  }
  return null;
}

/**
 * The same three words `--compare` prints: intervals that overlap are
 * weather; a gap in the improving direction is better.
 */
export function compareIntervals(
  after: HistoryInterval,
  before: HistoryInterval,
  better: "higher" | "closer",
): NoiseVerdict {
  const overlap = after.lo <= before.hi && before.lo <= after.hi;
  if (overlap) return "within noise";
  const improved =
    better === "higher"
      ? after.value > before.value
      : Math.abs(after.value) < Math.abs(before.value);
  return improved ? "better" : "worse";
}

export function compareAuc(
  after: HistoryInterval | null,
  before: HistoryInterval | null,
): NoiseVerdict | null {
  if (!after || !before) return null;
  const shifted = (interval: HistoryInterval): HistoryInterval => ({
    value: Math.abs(interval.value - 0.5),
    lo: Math.abs(interval.lo - 0.5),
    hi: Math.abs(interval.hi - 0.5),
  });
  return compareIntervals(shifted(after), shifted(before), "closer");
}
