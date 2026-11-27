import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { zonedDateKey } from "@shared/timezone";
import { Button } from "@/components/ui/button";

/**
 * The six weekly curves and the points where one of them moved (C2.5).
 *
 * A turning point is a claim about a number, not about a reason. The
 * user keeps it, rejects it, or writes down what they know.
 */
export default function TimelineChart({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  /**
   * The reader's own calendar for the event dates (C4.6).
   *
   * An event at 04:30 on the first in Shanghai is still the thirty-first
   * in Greenwich; slicing the stored instant showed the day before.
   */
  const { user } = useAuth();
  const timezone = (user as { timezone?: string | null } | null)?.timezone ?? null;
  const utils = trpc.useUtils();
  const timeline = trpc.record.timeline.useQuery({ personaId }, { enabled: personaId > 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const decide = trpc.turningPoint.confirm.useMutation({
    onSuccess: () => {
      setSelected(null);
      setNote("");
      void utils.record.timeline.invalidate({ personaId });
    },
  });
  const reject = trpc.turningPoint.reject.useMutation({
    onSuccess: () => {
      setSelected(null);
      void utils.record.timeline.invalidate({ personaId });
    },
  });
  const annotate = trpc.turningPoint.annotate.useMutation({
    onSuccess: () => {
      setSelected(null);
      setNote("");
      void utils.record.timeline.invalidate({ personaId });
    },
  });

  const labels: Record<string, string> = {
    total: t("report.series.total"),
    myShare: t("report.series.myShare"),
    replyMedianSec: t("report.series.replyMedianSec"),
    charsMedian: t("report.series.charsMedian"),
    startsMeShare: t("report.series.startsMeShare"),
    negativeShare: t("report.series.negativeShare"),
  };

  if (timeline.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (timeline.isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p>{t("report.failed")}</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => timeline.refetch()}>
          {t("report.retry")}
        </Button>
      </div>
    );
  }
  const series = timeline.data?.series ?? [];
  const points = timeline.data?.points ?? [];
  const events = timeline.data?.events ?? [];
  if (series.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("report.timelineEmpty")}</p>;
  }
  const selectedPoint = points.find((point) => point.id === selected) ?? null;
  const keys = ["total", "myShare", "replyMedianSec", "charsMedian", "startsMeShare", "negativeShare"];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">{t("report.timelineNote")}</p>
      <div className="grid grid-cols-1 gap-3">
        {keys.map((key) => (
          <div key={key} className="rounded-lg border border-border/70 p-2">
            <p className="text-xs text-muted-foreground">{labels[key]}</p>
            <div className="h-28" role="img" aria-label={labels[key]}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.map((week) => ({ week: week.week, value: week[key as keyof typeof week] }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="week" hide />
                  <YAxis hide />
                  <Tooltip />
                  <Line dataKey="value" dot={false} stroke="currentColor" strokeWidth={1.5} />
                  {events.map((event) => (
                    <ReferenceLine
                      key={`event-${event.at}-${event.title}`}
                      x={event.week}
                      stroke="currentColor"
                      strokeDasharray="2 4"
                      strokeOpacity={0.35}
                    />
                  ))}
                  {points
                    .filter((point) => point.changes.some((change) => change.series === key))
                    .map((point) => (
                      <ReferenceLine
                        key={point.id}
                        x={point.id}
                        stroke="currentColor"
                        strokeDasharray="4 4"
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          setSelected(point.id);
                          setNote(point.note ?? "");
                        }}
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {events.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("report.events")}</p>
          {events.map((event) => (
            <p key={`${event.at}-${event.title}`} className="text-xs text-muted-foreground">
              <span className="text-foreground">{zonedDateKey(new Date(event.at), timezone)}</span> · {event.title}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {points.map((point) => (
          <button
            key={point.id}
            type="button"
            data-turning-point={point.id}
            className={`block w-full rounded border px-2 py-1 text-left text-xs ${
              selected === point.id ? "border-primary/50 bg-primary/5" : "border-border/70"
            }`}
            onClick={() => {
              setSelected(point.id);
              setNote(point.note ?? "");
            }}
          >
            <span className="font-medium">{point.id}</span>
            {point.note && <span className="ml-2 text-muted-foreground">{point.note}</span>}
          </button>
        ))}
      </div>

      {selectedPoint && (
        <div className="rounded-lg border border-border/70 p-3 text-sm">
          <ul className="space-y-1">
            {selectedPoint.changes.map((change, index) => (
              <li key={`${change.series}-${index}`}>
                {t("report.change", {
                  series: labels[change.series] ?? change.series,
                  before: change.before,
                  after: change.after,
                })}
              </li>
            ))}
          </ul>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("report.notePlaceholder")}
            aria-label={t("report.annotate")}
            maxLength={500}
            className="mt-2 w-full rounded border border-border bg-background p-2 text-xs"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => decide.mutate({ personaId, id: selectedPoint.id, note: note.trim() || undefined })}
            >
              {t("report.confirm")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (note.trim()) annotate.mutate({ personaId, id: selectedPoint.id, note: note.trim() });
                else reject.mutate({ personaId, id: selectedPoint.id });
              }}
            >
              {note.trim() ? t("report.saveNote") : t("report.reject")}
            </Button>
            <a
              className="self-center text-xs underline underline-offset-2"
              href={`/persona/${personaId}/records?atDate=${selectedPoint.weekStart ?? selectedPoint.id}`}
            >
              {t("report.jumpWeek")}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
