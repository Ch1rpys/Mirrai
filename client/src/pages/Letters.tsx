import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Mail, Clock, Archive, CalendarClock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { formatDateTimeInZone } from "@/lib/dates";
import { useAuth } from "@/_core/hooks/useAuth";
import PageLoader from "@/components/PageLoader";

/**
 * The mailbox (C8.2).
 *
 * Everything that is waiting for the user, across every persona, in
 * five groups. Before this page each of the five lived somewhere else:
 * an answered letter on the persona's own page, a capsule in that
 * page's box, a reply that arrived overnight in a conversation the user
 * would have to remember to open. There was one place to look per
 * person and no place to look for all of them.
 *
 * The groups are deliberately the things the user is waiting on — a
 * reply that came, one that has not, a letter never sent, a capsule
 * whose day came, and one that has not. Nothing here counts a
 * proactive message: those are waiting quietly in the conversation.
 */

type LetterRow = {
  id: number;
  personaId: number;
  body: string;
  status: string;
  mood: string | null;
  replyAt: string | Date | null;
  repliedAt: string | Date | null;
  replyText: string | null;
  readAt: string | Date | null;
  createdAt: string | Date;
  personaName: string;
};

type ScheduledRow = {
  id: number;
  personaId: number;
  kind: string;
  body: string;
  dueAt: string | Date;
  status: string;
  openedAt: string | Date | null;
  personaName: string;
};

function preview(text: string | null | undefined, max = 90): string {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default function Letters() {
  const [, navigate] = useLocation();
  const { t, locale } = useLocale();
  const { isAuthenticated, user } = useAuth({ redirectOnUnauthenticated: true });
  const timezone = (user as { timezone?: string | null } | null)?.timezone ?? null;
  const utils = trpc.useUtils();
  const inbox = trpc.letter.inbox.useQuery(undefined, { enabled: isAuthenticated });
  const markRead = trpc.letter.markRead.useMutation({
    onSuccess: () => {
      utils.letter.inbox.invalidate();
      utils.letter.unreadCount.invalidate();
    },
  });
  const markOpened = trpc.scheduled.markOpened.useMutation({
    onSuccess: () => {
      utils.letter.inbox.invalidate();
      utils.letter.unreadCount.invalidate();
    },
  });
  /** Which letter is open on the page, and which capsule. */
  const [openLetter, setOpenLetter] = useState<number | null>(null);
  const [openCapsule, setOpenCapsule] = useState<number | null>(null);

  if (!isAuthenticated) return <PageLoader />;

  const dateOf = (value: string | Date | null) =>
    value ? formatDateTimeInZone(value, locale, timezone) : "";

  const toggleLetter = (row: LetterRow) => {
    if (openLetter === row.id) {
      setOpenLetter(null);
      return;
    }
    setOpenLetter(row.id);
    if (row.status === "answered" && !row.readAt) {
      markRead.mutate({ id: row.id });
    }
  };

  const toggleCapsule = (row: ScheduledRow) => {
    if (openCapsule === row.id) {
      setOpenCapsule(null);
      return;
    }
    setOpenCapsule(row.id);
    markOpened.mutate({ id: row.id });
  };

  if (inbox.isLoading) {
    return (
      <main className="container py-10">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </main>
    );
  }

  if (inbox.isError) {
    return (
      <main className="container py-10 space-y-3">
        <p className="text-sm text-muted-foreground">{t("mailbox.failed")}</p>
        <button
          type="button"
          onClick={() => inbox.refetch()}
          className="text-sm underline underline-offset-2"
        >
          {t("common.retry")}
        </button>
      </main>
    );
  }

  const data = inbox.data;
  const received = (data?.received ?? []) as LetterRow[];
  const waiting = (data?.waiting ?? []) as LetterRow[];
  const kept = (data?.kept ?? []) as LetterRow[];
  const capsules = (data?.capsules ?? []) as ScheduledRow[];
  const upcoming = (data?.upcoming ?? []) as ScheduledRow[];

  const empty = (key: "received" | "waiting" | "kept" | "capsules" | "upcoming") => (
    <p className="text-xs text-muted-foreground">{t(`mailbox.empty.${key}` as never)}</p>
  );

  return (
    <main className="container py-10 max-w-3xl space-y-8">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        {t("common.back")}
      </button>

      <header className="space-y-1">
        <p className="kicker">{t("mailbox.kicker")}</p>
        <h1 className="page-title">{t("mailbox.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("mailbox.note")}</p>
      </header>

      {/* 收到的回信 */}
      <section className="space-y-2" aria-label={t("mailbox.received")}>
        <p className="kicker flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5" />
          {t("mailbox.received")}
        </p>
        {received.length === 0 && empty("received")}
        <ul className="space-y-2">
          {received.map((row) => (
            <li key={row.id} className="rounded-lg border border-border/70 px-3 py-2 space-y-1">
              <button
                type="button"
                onClick={() => toggleLetter(row)}
                className="w-full text-left"
              >
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  {!row.readAt && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-foreground"
                      aria-label={t("mailbox.unread")}
                    />
                  )}
                  <span>{t("mailbox.replyFrom", { name: row.personaName })}</span>
                  <span>{dateOf(row.repliedAt ?? row.createdAt)}</span>
                </p>
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                  {openLetter === row.id
                    ? row.replyText ?? ""
                    : preview(row.replyText ?? row.body)}
                </p>
              </button>
              {openLetter === row.id && (
                <>
                  <p className="text-xs text-muted-subtle">
                    {t("mailbox.yourLetter")}
                  </p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                    {row.body}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 在等回信 */}
      <section className="space-y-2" aria-label={t("mailbox.waiting")}>
        <p className="kicker flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {t("mailbox.waiting")}
        </p>
        {waiting.length === 0 && empty("waiting")}
        <ul className="space-y-2">
          {waiting.map((row) => (
            <li key={row.id} className="rounded-lg border border-border/70 px-3 py-2 space-y-1">
              <p className="text-xs text-muted-foreground">
                {t("mailbox.waitingFor", { name: row.personaName })}
                {row.replyAt ? ` · ${t("mailbox.waitingDue", { date: dateOf(row.replyAt) })}` : ""}
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {preview(row.body, 140)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* 写了没寄的 */}
      <section className="space-y-2" aria-label={t("mailbox.kept")}>
        <p className="kicker flex items-center gap-1.5">
          <Archive className="w-3.5 h-3.5" />
          {t("mailbox.kept")}
        </p>
        {kept.length === 0 && empty("kept")}
        <ul className="space-y-2">
          {kept.map((row) => (
            <li key={row.id} className="rounded-lg border border-border/70 px-3 py-2 space-y-1">
              <p className="text-xs text-muted-foreground">
                {row.personaName} · {dateOf(row.createdAt)}
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                {openLetter === row.id ? row.body : preview(row.body, 140)}
              </p>
              <button
                type="button"
                onClick={() => setOpenLetter(openLetter === row.id ? null : row.id)}
                className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
              >
                {openLetter === row.id ? t("mailbox.collapse") : t("mailbox.readFull")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* 到日子的胶囊 */}
      <section className="space-y-2" aria-label={t("mailbox.capsules")}>
        <p className="kicker flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" />
          {t("mailbox.capsules")}
        </p>
        {capsules.length === 0 && empty("capsules")}
        <ul className="space-y-2">
          {capsules.map((row) => (
            <li key={row.id} className="rounded-lg border border-border/70 px-3 py-2 space-y-1">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                {!row.openedAt && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full bg-foreground"
                    aria-label={t("mailbox.unread")}
                  />
                )}
                <span>
                  {t("mailbox.capsuleFrom", {
                    name: row.personaName,
                    date: dateOf(row.dueAt),
                  })}
                </span>
              </p>
              <button
                type="button"
                onClick={() => toggleCapsule(row)}
                className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
              >
                {openCapsule === row.id ? t("mailbox.collapse") : t("mailbox.openCapsule")}
              </button>
              {openCapsule === row.id && (
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                  {row.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 还没到日子 */}
      <section className="space-y-2" aria-label={t("mailbox.upcoming")}>
        <p className="kicker flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" />
          {t("mailbox.upcoming")}
        </p>
        {upcoming.length === 0 && empty("upcoming")}
        <ul className="space-y-2">
          {upcoming.map((row) => (
            <li key={row.id} className="rounded-lg border border-border/70 px-3 py-2 space-y-1">
              <p className="text-xs text-muted-foreground">
                {t("mailbox.upcomingLine", {
                  name: row.personaName,
                  date: dateOf(row.dueAt),
                })}
              </p>
              {row.kind !== "capsule" && (
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                  {preview(row.body, 140)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
