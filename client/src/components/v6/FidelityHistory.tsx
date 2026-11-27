import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { useDayKey } from "@/lib/day";
import type { TranslationKey } from "@/i18n";
import {
  compareAuc,
  compareColumnsFromVersions,
  compareIntervals,
  historyPointsFromRuns,
  latestAblationFromRuns,
  timeOf,
  type CompareColumn,
  type HistoryPoint,
  type HistoryRun,
  type HistoryVersion,
  type NoiseVerdict,
} from "./fidelity-history";

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function verdictKey(verdict: NoiseVerdict): TranslationKey {
  if (verdict === "better") return "fidelity.verdictBetter";
  if (verdict === "worse") return "fidelity.verdictWorse";
  return "fidelity.verdictNoise";
}

/**
 * The four lines, as points a test can count without the chart library.
 */
export function FidelityHistoryChart(props: {
  points: HistoryPoint[];
  versions: HistoryVersion[];
}) {
  const { t } = useLocale();
  const day = useDayKey();
  const data = props.points.map((point) => ({
    at: point.at,
    overlap: point.overlap.value,
    likelihoodGap: point.likelihoodGap.value,
    style: point.style.value,
    auc: point.auc?.value ?? null,
  }));
  return (
    <div className="space-y-3">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="at"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(at: number) => day(new Date(at).toISOString())}
              stroke="var(--color-muted-foreground)"
              fontSize={11}
            />
            <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
            <Tooltip
              labelFormatter={(at) => new Date(Number(at)).toISOString().slice(0, 16).replace("T", " ")}
              contentStyle={{
                background: "var(--color-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="overlap" name={t("fidelity.historyOverlap")} stroke="#2563eb" dot strokeWidth={2} />
            <Line type="monotone" dataKey="likelihoodGap" name={t("fidelity.historyLikelihood")} stroke="#16a34a" dot strokeWidth={2} />
            <Line type="monotone" dataKey="style" name={t("fidelity.historyStyle")} stroke="#d97706" dot strokeWidth={2} />
            <Line type="monotone" dataKey="auc" name={t("fidelity.historyAuc")} stroke="#7c3aed" dot strokeWidth={2} connectNulls={false} />
            {props.versions.map((version) => (
              <ReferenceLine
                key={version.id}
                x={timeOf(version.createdAt)}
                stroke="var(--color-foreground)"
                strokeDasharray="4 4"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ol data-testid="fidelity-history-points" className="space-y-1 text-[11px] text-muted-foreground">
        {props.points.map((point) => (
          <li key={point.runId} data-testid="fidelity-history-point">
            {t("fidelity.historyOverlap")} {fmt(point.overlap.value)} (
            {t("fidelity.historyCi", { lo: fmt(point.overlap.lo), hi: fmt(point.overlap.hi) })})
            {" · "}
            {t("fidelity.historyLikelihood")} {fmt(point.likelihoodGap.value)} (
            {t("fidelity.historyCi", {
              lo: fmt(point.likelihoodGap.lo),
              hi: fmt(point.likelihoodGap.hi),
            })}
            )
            {" · "}
            {t("fidelity.historyStyle")} {fmt(point.style.value)} (
            {t("fidelity.historyCi", { lo: fmt(point.style.lo), hi: fmt(point.style.hi) })})
            {point.auc ? (
              <>
                {" · "}
                {t("fidelity.historyAuc")} {fmt(point.auc.value)} (
                {t("fidelity.historyCi", { lo: fmt(point.auc.lo), hi: fmt(point.auc.hi) })})
              </>
            ) : null}
          </li>
        ))}
      </ol>
      {props.versions.length > 0 ? (
        <ul data-testid="fidelity-version-marks" className="text-[11px] text-muted-subtle space-y-0.5">
          {props.versions.map((version) => (
            <li key={version.id} data-testid="fidelity-version-mark">
              {version.reason} · {day(version.createdAt)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FidelityCompare(props: { columns: CompareColumn[] }) {
  const { t } = useLocale();
  const before = props.columns[0]?.point;
  const after = props.columns[1]?.point;
  const overlapVerdict =
    before && after ? compareIntervals(after.overlap, before.overlap, "higher") : null;
  const likelihoodVerdict =
    before && after ? compareIntervals(after.likelihoodGap, before.likelihoodGap, "closer") : null;
  const styleVerdict =
    before && after ? compareIntervals(after.style, before.style, "closer") : null;
  const aucVerdict = before && after ? compareAuc(after.auc, before.auc) : null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium">{t("fidelity.compareTitle")}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {props.columns.map((column, index) => (
          <div
            key={`${column.role}-${column.versionId}-${index}`}
            data-testid="fidelity-compare-column"
            className="rounded-md border border-border/70 p-3 space-y-1 text-xs"
          >
            <p className="text-sm font-medium">
              {column.role === "before"
                ? t("fidelity.compareBefore")
                : column.role === "after"
                  ? t("fidelity.compareAfter")
                  : t("fidelity.compareVersion", { id: column.versionId })}
            </p>
            {column.point ? (
              <>
                <p>
                  {t("fidelity.historyOverlap")} {fmt(column.point.overlap.value)}
                </p>
                <p>
                  {t("fidelity.historyLikelihood")} {fmt(column.point.likelihoodGap.value)}
                </p>
                <p>
                  {t("fidelity.historyStyle")} {fmt(column.point.style.value)}
                </p>
                <p>
                  {t("fidelity.historyAuc")} {column.point.auc ? fmt(column.point.auc.value) : "—"}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">{t("fidelity.historyEmpty")}</p>
            )}
          </div>
        ))}
      </div>
      {overlapVerdict && likelihoodVerdict && styleVerdict ? (
        <ul className="text-[11px] text-muted-foreground space-y-0.5">
          <li>
            {t("fidelity.historyOverlap")} {String(t(verdictKey(overlapVerdict)))}
          </li>
          <li>
            {t("fidelity.historyLikelihood")} {String(t(verdictKey(likelihoodVerdict)))}
          </li>
          <li>
            {t("fidelity.historyStyle")} {String(t(verdictKey(styleVerdict)))}
          </li>
          {aucVerdict ? (
            <li>
              {t("fidelity.historyAuc")} {String(t(verdictKey(aucVerdict)))}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function asBlindSummary(raw: unknown): {
  n: number;
  pickedReal: number;
  pickedPersona: number;
  unsure: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const n = typeof record.n === "number" ? record.n : 0;
  const pickedReal = typeof record.pickedReal === "number" ? record.pickedReal : 0;
  const pickedPersona = typeof record.pickedPersona === "number" ? record.pickedPersona : 0;
  const unsure = typeof record.unsure === "number" ? record.unsure : 0;
  return { n, pickedReal, pickedPersona, unsure };
}

/**
 * The history of the ruler: the curve, the last distillation, the last
 * ablation, and the last three in-app blinds.
 */
export default function FidelityHistory(props: { personaId: number }) {
  const { t } = useLocale();
  const runsQuery = trpc.eval.list.useQuery(
    { personaId: props.personaId, limit: 50 },
    { enabled: props.personaId > 0 },
  );
  const versionsQuery = trpc.personaVersion.list.useQuery(
    { id: props.personaId },
    { enabled: props.personaId > 0 },
  );
  const blindsQuery = trpc.blind.list.useQuery(
    { personaId: props.personaId },
    { enabled: props.personaId > 0 },
  );

  if (runsQuery.isError) {
    return (
      <div className="space-y-2" data-testid="fidelity-history-error">
        <p className="text-xs text-destructive" role="alert">
          {t("common.error")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void runsQuery.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const runs = (runsQuery.data?.runs ?? []) as HistoryRun[];
  const versions = (versionsQuery.data?.versions ?? []) as HistoryVersion[];
  const points = historyPointsFromRuns(runs);
  const columns = compareColumnsFromVersions(versions, runs);
  const ablation = latestAblationFromRuns(runs);
  const blinds = blindsQuery.data?.sessions ?? [];

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium">{t("fidelity.history")}</h3>
      {points.length === 0 ? (
        <div data-testid="fidelity-history-empty" className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("fidelity.historyEmpty")}</p>
          <p className="text-xs text-muted-foreground">{t("fidelity.historyHowToStart")}</p>
        </div>
      ) : (
        <FidelityHistoryChart points={points} versions={versions} />
      )}

      {columns.length >= 2 ? <FidelityCompare columns={columns} /> : null}

      <div className="space-y-2">
        <h4 className="text-xs font-medium">{t("fidelity.ablateTitle")}</h4>
        {ablation && ablation.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="py-1 pr-3 font-medium">{t("fidelity.ablateLayer")}</th>
                  <th className="py-1 pr-3 font-medium">{t("fidelity.historyOverlap")}</th>
                  <th className="py-1 pr-3 font-medium">{t("fidelity.historyLikelihood")}</th>
                  <th className="py-1 pr-3 font-medium">{t("fidelity.historyStyle")}</th>
                  <th className="py-1 pr-3 font-medium">{t("fidelity.historyActMatch")}</th>
                  <th className="py-1 font-medium">{t("fidelity.ablateVerdict")}</th>
                </tr>
              </thead>
              <tbody>
                {ablation.map((row) => (
                  <tr key={row.layer} className="border-t border-border/60">
                    <td className="py-1.5 pr-3">{row.layer}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{fmt(row.overlap)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{fmt(row.likelihoodGap)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{fmt(row.styleDistance)}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{fmt(row.actMatch)}</td>
                    <td className="py-1.5">{row.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("fidelity.ablateNone")}</p>
            <p className="text-xs text-muted-foreground">{t("fidelity.ablateHow")}</p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium">{t("fidelity.blindsRecent")}</h4>
        {blinds.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("fidelity.blindsNone")}</p>
        ) : (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {blinds.map((session) => {
              const summary = asBlindSummary(session.summary);
              const n = summary?.n ?? 0;
              const real = summary ? Math.round(summary.pickedReal * n) : 0;
              const persona = summary ? Math.round(summary.pickedPersona * n) : 0;
              const unsure = summary ? Math.round(summary.unsure * n) : 0;
              return (
                <li key={session.id}>
                  {summary
                    ? t("fidelity.blind.result", { n, real, persona, unsure })
                    : t("fidelity.blindsNone")}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
