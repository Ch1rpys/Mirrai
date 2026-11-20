import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { formatDayKey } from "@/lib/dates";

/**
 * Everything the user wrote or recorded about themselves, in one line of
 * time (C4.5).
 *
 * The four streams — the diary they wrote, their mood check-ins, the
 * relationship events and the answers after a conversation — lived on
 * four different pages, in four different orders. This puts them on one
 * page by date, with a mark for which stream each one came from. Nothing
 * here is read by a model.
 */
/** A UTC calendar day, for sorting and for the date column. */
function isoDay(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

type TimelineItem = {
  key: string;
  kind: "journal" | "mood" | "event" | "checkin";
  date: string;
  title: string;
  detail: string | null;
};

export default function PersonalTimeline({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const journal = trpc.journal.list.useQuery({ personaId });
  const moods = trpc.user.moods.useQuery({ days: 365 });
  const events = trpc.relationship.list.useQuery({ personaId, limit: 200 });
  const checkins = trpc.checkin.recent.useQuery({ personaId });

  const items: TimelineItem[] = [];
  for (const entry of journal.data?.entries ?? []) {
    items.push({
      key: `journal:${entry.id}`,
      kind: "journal",
      date: entry.entryDate,
      title: t("timeline.journal"),
      detail: entry.body,
    });
  }
  for (const mood of moods.data ?? []) {
    items.push({
      key: `mood:${mood.date}`,
      kind: "mood",
      date: mood.date,
      title: t("timeline.mood"),
      detail: mood.note || (mood.mood as string),
    });
  }
  for (const event of events.data?.events ?? []) {
    items.push({
      key: `event:${event.id}`,
      kind: "event",
      date: isoDay(event.happenedAt),
      title: t("timeline.event"),
      detail: event.title,
    });
  }
  for (const [index, answer] of (checkins.data?.answers ?? []).entries()) {
    const at = answer.createdAt instanceof Date ? answer.createdAt : new Date(answer.createdAt);
    items.push({
      key: `checkin:${index}`,
      kind: "checkin",
      date: Number.isNaN(at.getTime()) ? "" : isoDay(at),
      title: t("timeline.checkin"),
      detail:
        answer.answer === "better"
          ? t("afterChat.better")
          : answer.answer === "same"
            ? t("afterChat.same")
            : answer.answer === "worse"
              ? t("afterChat.worse")
              : t("afterChat.skipped"),
    });
  }

  const sorted = items
    .filter((item) => item.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key)));

  const failed = journal.isError || moods.isError || events.isError || checkins.isError;
  const loading = journal.isLoading || moods.isLoading;

  return (
    <section className="space-y-3">
      <h2 className="section-title">{t("timeline.title")}</h2>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("timeline.hint")}</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : failed ? (
        <p className="text-xs text-muted-foreground">{t("common.error")}</p>
      ) : sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("timeline.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((item) => (
            <li key={item.key} className="flex gap-3 rounded-lg border border-border/60 p-3" data-timeline-kind={item.kind}>
              <span className="w-16 shrink-0 text-[11px] text-muted-subtle">
                {formatDayKey(item.date, locale)}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-[11px] font-medium text-foreground/80">{item.title}</p>
                <p className="text-sm leading-relaxed text-foreground/85 line-clamp-3">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
