import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useDayKey } from "@/lib/day";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { copy } from "@shared/copy";
import { SPEECH_ACTS, USER_ACTS, USER_ACT_COPY_KEYS, FEEDBACK_REASONS, type SpeechAct } from "@shared/speech-acts";
import { SUPPRESSION_KINDS, normalizeSuppressions, type Suppression, type SuppressionKind } from "@shared/suppressions";
import { normalizeLifeEvents, type LifeEvent, type LifeEventKind } from "@shared/life-events";
import { ACT_MIN_SAMPLES, emptyCounts, normalizeActProfile, topRepliesForUserAct, type ActCounts } from "@shared/act-profile";
import type { Locale } from "@shared/copy";

/**
 * The fifth-stage editors: subtractions, life events, action counts,
 * and the unlike-feedback queue.
 *
 * They live on the persona page because a rule that cannot be checked
 * is a rule that cannot be trusted, and because a mark of "unlike"
 * that never becomes a candidate is a button that does nothing.
 */

let stamp = 0;
function nextId(prefix: string): string {
  stamp += 1;
  return `${prefix}-${Date.now()}-${stamp}`;
}

export default function V5FidelityEditors({ personaId }: { personaId: number }) {
  return (
    <div className="space-y-8">
      <SuppressionsEditor personaId={personaId} />
      <LifeEventsEditor personaId={personaId} />
      <ActProfileEditor personaId={personaId} />
      <FeedbackQueue personaId={personaId} />
    </div>
  );
}

function SuppressionsEditor({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const lang = locale === "en" ? "en" : "zh";
  const { data, refetch, isError } = trpc.suppression.list.useQuery({ personaId });
  const save = trpc.suppression.save.useMutation({
    onSuccess: () => { toast.success(t("imperfection.saved")); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const mine = trpc.suppression.mine.useMutation({
    onSuccess: (result) => {
      if (!result.rules.length) toast.info(result.hint ?? copy(lang, "prompt.samplesTooThin"));
      else toast.success(copy(lang, "labels.suppressions.mine"));
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [pattern, setPattern] = useState("");
  const [kind, setKind] = useState<SuppressionKind>("no_phrase");
  const rules = normalizeSuppressions(data?.rules);

  function persist(next: Suppression[]) {
    save.mutate({ personaId, rules: next });
  }

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("v5.suppressionsTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("v5.suppressionsHint")}</p>
        {data?.hint ? <p className="text-[11px] text-muted-subtle">{data.hint}</p> : null}
      </header>
      {isError ? <p className="text-xs text-destructive" role="alert">{t("common.error")}</p> : null}
      <ul className="space-y-2">
        {rules.map((rule) => (
          <li key={rule.id} className="rounded-md border border-border p-3 space-y-1.5">
            <p className="text-sm">{copy(lang, `prompt.suppression.${rule.kind}` as "prompt.suppression.no_phrase", { pattern: rule.pattern })}</p>
            <div className="flex flex-wrap gap-2">
              {!rule.verified ? (
                <Button size="sm" variant="outline" onClick={() => persist(rules.map((row) => row.id === rule.id ? { ...row, verified: true } : row))}>
                  {t("v5.verify")}
                </Button>
              ) : (
                <span className="text-[11px] text-muted-subtle">{t("v5.verified")}</span>
              )}
              <Button size="sm" variant="ghost" onClick={() => persist(rules.filter((row) => row.id !== rule.id))}>
                {t("common.delete")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as SuppressionKind)} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
          {SUPPRESSION_KINDS.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={t("v5.phrasePlaceholder")} maxLength={200} />
        <Button size="sm" disabled={!pattern.trim() || save.isPending} onClick={() => {
          persist([...rules, {
            id: nextId("manual"),
            pattern: pattern.trim(),
            kind,
            confidence: 1,
            source: "manual",
            verified: true,
            evidence: [],
          }]);
          setPattern("");
        }}>{t("v5.addRule")}</Button>
        <Button size="sm" variant="outline" disabled={mine.isPending} onClick={() => mine.mutate({ personaId, locale: lang })}>
          {copy(lang, "labels.suppressions.mine")}
        </Button>
      </div>
    </section>
  );
}

function LifeEventsEditor({ personaId }: { personaId: number }) {
  const day = useDayKey();
  const { t, locale } = useLocale();
  const lang = locale === "en" ? "en" : "zh";
  const { data, refetch, isError } = trpc.lifeEvent.list.useQuery({ personaId });
  const save = trpc.lifeEvent.save.useMutation({
    onSuccess: () => { toast.success(t("imperfection.saved")); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const mine = trpc.lifeEvent.mine.useMutation({
    onSuccess: (result) => {
      if (!result.events.length) toast.info(copy(lang, "labels.lifeEvents.empty"));
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<LifeEventKind>("open_loop");
  const [weekday, setWeekday] = useState(3);
  const [startHour, setStartHour] = useState(14);
  const [endHour, setEndHour] = useState(16);
  const events = normalizeLifeEvents(data?.events);

  function persist(next: LifeEvent[]) {
    save.mutate({ personaId, events: next });
  }

  function patchSchedule(event: LifeEvent, patch: Partial<{ weekday: number; startHour: number; endHour: number }>): LifeEvent {
    const schedule = event.schedule ?? { weekdays: [weekday], startHour, endHour };
    const nextWeekday = patch.weekday ?? schedule.weekdays[0] ?? 3;
    const nextStart = patch.startHour ?? schedule.startHour;
    const nextEnd = patch.endHour ?? schedule.endHour;
    return {
      ...event,
      schedule: {
        weekdays: [nextWeekday],
        startHour: Math.max(0, Math.min(23, nextStart)),
        endHour: Math.max(nextStart + 1, Math.min(24, nextEnd)),
      },
    };
  }

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("v5.lifeEventsTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("v5.lifeEventsHint")}</p>
        <p className="text-xs text-muted-foreground">{t("v5.routineHint")}</p>
        {data?.hint ? <p className="text-[11px] text-muted-subtle">{data.hint}</p> : null}
      </header>
      {isError ? <p className="text-xs text-destructive" role="alert">{t("common.error")}</p> : null}
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="rounded-md border border-border p-3 space-y-1.5">
            <p className="text-sm font-medium">{event.title}</p>
            {event.detail ? <p className="text-xs text-muted-foreground">{event.detail}</p> : null}
            {event.kind === "routine" && event.schedule ? (
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  aria-label={t("v5.weekday")}
                  className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                  value={event.schedule.weekdays[0] ?? 0}
                  onChange={(e) => persist(events.map((row) => row.id === event.id ? patchSchedule(row, { weekday: Number(e.target.value) }) : row))}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                    <option key={day} value={day}>{copy(lang, `labels.routine.weekday.${day}` as "labels.routine.weekday.3")}</option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  className="h-8 w-20"
                  aria-label={t("v5.scheduleStart")}
                  value={event.schedule.startHour}
                  onChange={(e) => persist(events.map((row) => row.id === event.id ? patchSchedule(row, { startHour: Number(e.target.value) }) : row))}
                />
                <Input
                  type="number"
                  min={1}
                  max={24}
                  className="h-8 w-20"
                  aria-label={t("v5.scheduleEnd")}
                  value={event.schedule.endHour}
                  onChange={(e) => persist(events.map((row) => row.id === event.id ? patchSchedule(row, { endHour: Number(e.target.value) }) : row))}
                />
                <span className="text-[11px] text-muted-subtle">
                  {copy(lang, `labels.routine.weekday.${event.schedule.weekdays[0] ?? 0}` as "labels.routine.weekday.3")}
                  {" "}
                  {event.schedule.startHour}–{event.schedule.endHour}
                </span>
              </div>
            ) : null}
            {event.evidence.length > 0 ? (
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer">{t("common.evidence")}</summary>
                <ul className="mt-1 space-y-0.5">
                  {event.evidence.map((row, index) => (
                    <li key={`${row.at ?? ""}:${index}`} className="leading-relaxed">
                      {row.at ? `${day(row.at)} ` : ""}{row.snippet}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!event.verified ? (
                <Button size="sm" variant="outline" onClick={() => persist(events.map((row) => row.id === event.id ? { ...row, verified: true } : row))}>
                  {t("v5.verify")}
                </Button>
              ) : (
                <span className="text-[11px] text-muted-subtle">{t("v5.verified")}</span>
              )}
              {!event.closed ? (
                <Button size="sm" variant="outline" onClick={() => persist(events.map((row) => row.id === event.id ? { ...row, closed: true } : row))}>
                  {t("v5.closeLoop")}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => persist(events.filter((row) => row.id !== event.id))}>
                {t("common.delete")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col sm:flex-row gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as LifeEventKind)} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
          <option value="open_loop">{t("v5.kindLoop")}</option>
          <option value="life">{t("v5.kindLife")}</option>
          <option value="routine">{t("v5.kindRoutine")}</option>
        </select>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("v5.eventPlaceholder")} maxLength={80} />
        {kind === "routine" ? (
          <>
            <select aria-label={t("v5.weekday")} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
              {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                <option key={day} value={day}>{copy(lang, `labels.routine.weekday.${day}` as "labels.routine.weekday.3")}</option>
              ))}
            </select>
            <Input type="number" min={0} max={23} className="h-9 w-20" aria-label={t("v5.scheduleStart")} value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} />
            <Input type="number" min={1} max={24} className="h-9 w-20" aria-label={t("v5.scheduleEnd")} value={endHour} onChange={(e) => setEndHour(Number(e.target.value))} />
          </>
        ) : null}
        <Button size="sm" disabled={!title.trim() || save.isPending || (kind === "routine" && endHour <= startHour)} onClick={() => {
          persist([...events, {
            id: nextId("event"),
            kind,
            title: title.trim(),
            detail: "",
            whoSaid: "",
            closed: false,
            source: "manual",
            verified: true,
            evidence: [],
            ...(kind === "routine" ? { schedule: { weekdays: [weekday], startHour, endHour } } : {}),
          }]);
          setTitle("");
        }}>{t("v5.addEvent")}</Button>
        <Button size="sm" variant="outline" disabled={mine.isPending} onClick={() => mine.mutate({ personaId })}>
          {copy(lang, "labels.suppressions.mine")}
        </Button>
      </div>
    </section>
  );
}

function ActProfileEditor({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const lang = locale === "en" ? "en" : "zh";
  const { data, refetch } = trpc.actProfile.get.useQuery({ personaId });
  const save = trpc.actProfile.save.useMutation({
    onSuccess: () => { toast.success(t("imperfection.saved")); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const profile = normalizeActProfile(data?.profile);
  const [counts, setCounts] = useState<ActCounts>(emptyCounts());

  useEffect(() => {
    setCounts(profile?.unconditional ?? emptyCounts());
  }, [profile?.measuredAt, profile?.samples]);

  if (!profile || profile.samples < ACT_MIN_SAMPLES) {
    return (
      <section className="space-y-1">
        <h3 className="text-sm font-medium">{t("v5.actProfileTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("v5.actProfileHint")}</p>
        <p className="text-[11px] text-muted-subtle">{copy(lang, "prompt.samplesTooThin")}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("v5.actProfileTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("v5.actProfileHint")}</p>
      </header>
      <dl className="grid gap-2 sm:grid-cols-2">
        {SPEECH_ACTS.map((act: SpeechAct) => (
          <div key={act} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
            <dt className="text-xs">{copy(lang, `prompt.act.${act}` as "prompt.act.answer")}</dt>
            <dd>
              <Input
                type="number"
                min={0}
                className="h-8 w-20"
                aria-label={t("v5.countPlaceholder")}
                value={counts[act] ?? 0}
                onChange={(e) => setCounts({ ...counts, [act]: Math.max(0, Number(e.target.value) || 0) })}
              />
            </dd>
          </div>
        ))}
      </dl>
      <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({
        personaId,
        profile: { ...profile, unconditional: counts, edited: true },
      })}>
        {t("common.save")}
      </Button>
      <AdjacencyTable
        byUserAct={profile.byUserAct}
        locale={lang}
        title={t("v5.actAdjacencyTitle")}
        hint={t("v5.actAdjacencyHint")}
        share={(act, pct) => t("v5.actAdjacencyShare", { act, pct })}
      />
    </section>
  );
}

function AdjacencyTable({
  byUserAct,
  locale,
  title,
  hint,
  share,
}: {
  byUserAct: Partial<Record<(typeof USER_ACTS)[number], ActCounts>> | undefined;
  locale: Locale;
  title: string;
  hint: string;
  share: (act: string, pct: number) => string;
}) {
  if (!byUserAct) return null;
  const rows = USER_ACTS.map((userAct) => {
    const counts = byUserAct[userAct];
    if (!counts) return null;
    const top = topRepliesForUserAct(counts, 3);
    if (top.length === 0) return null;
    return { userAct, top };
  }).filter((row): row is { userAct: (typeof USER_ACTS)[number]; top: ReturnType<typeof topRepliesForUserAct> } => Boolean(row));
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.userAct} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <dt>{copy(locale, USER_ACT_COPY_KEYS[row.userAct])}</dt>
            <dd className="text-muted-foreground">
              {row.top
                .map((item) =>
                  share(copy(locale, `prompt.act.${item.act}` as "prompt.act.answer"), Math.round(item.share * 100)),
                )
                .join(" · ")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function confirmLabel(kind: "suppression" | "act" | "memory" | "display"): "v5.confirmFeedback" | "v5.confirmAct" | "v5.confirmInvented" | "v5.dismissFeedback" {
  if (kind === "act") return "v5.confirmAct";
  if (kind === "memory") return "v5.confirmInvented";
  if (kind === "display") return "v5.dismissFeedback";
  return "v5.confirmFeedback";
}

function FeedbackQueue({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const { data, refetch, isError } = trpc.fidelity.candidates.useQuery({ personaId });
  const reject = trpc.fidelity.reject.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  const confirm = trpc.fidelity.confirm.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  const items = data?.items ?? [];

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("v5.feedbackTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("v5.feedbackHint")}</p>
      </header>
      {isError ? <p className="text-xs text-destructive" role="alert">{t("common.error")}</p> : null}
      {items.length === 0 ? (
        <p className="text-xs text-muted-subtle">{t("v5.noFeedback")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <FeedbackItem
              key={item.key}
              personaId={personaId}
              item={item}
              pending={reject.isPending || confirm.isPending}
              onReject={() => reject.mutate({ personaId, key: item.key })}
              onConfirm={(act) => {
                confirm.mutate(
                  { personaId, key: item.key, ...(act ? { act } : {}) },
                  {
                    onSuccess: () => {
                      void utils.suppression.list.invalidate({ personaId });
                      void utils.actProfile.get.invalidate({ personaId });
                    },
                  },
                );
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedbackItem({
  personaId,
  item,
  pending,
  onReject,
  onConfirm,
}: {
  personaId: number;
  item: {
    key: string;
    reason: string;
    messageId: number;
    kind: "suppression" | "act" | "memory" | "display";
    snippet?: string;
    rewrite?: string;
    sampledAct?: SpeechAct | null;
  };
  pending: boolean;
  onReject: () => void;
  onConfirm: (act?: SpeechAct) => void;
}) {
  const { t } = useLocale();
  const [act, setAct] = useState<SpeechAct>(item.sampledAct ?? "share");

  return (
    <li className="rounded-md border border-border p-3 space-y-1.5">
      <p className="text-sm">
        {FEEDBACK_REASONS.includes(item.reason as typeof FEEDBACK_REASONS[number])
          ? t(`chat.unlikeReasons.${item.reason}` as "chat.unlikeReasons.act")
          : item.reason}
      </p>
      {item.snippet && item.rewrite ? (
        <p className="text-xs text-muted-foreground">
          {t("v5.rewriteContrast", { unlike: item.snippet, rewrite: item.rewrite })}
        </p>
      ) : item.snippet ? (
        <p className="text-xs text-muted-foreground">{item.snippet}</p>
      ) : null}
      {item.kind === "act" ? (
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("v5.sampledAct")}</span>
          <select
            value={act}
            onChange={(e) => setAct(e.target.value as SpeechAct)}
            className="h-8 rounded-md border border-input bg-card px-2"
          >
            {SPEECH_ACTS.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <a className="text-xs underline underline-offset-2" href={`/chat/${personaId}#m-${item.messageId}`}>
          {t("v5.jumpReply")}
        </a>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onConfirm(item.kind === "act" ? act : undefined)}
        >
          {t(confirmLabel(item.kind))}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onReject}>
          {t("v5.rejectFeedback")}
        </Button>
      </div>
    </li>
  );
}
