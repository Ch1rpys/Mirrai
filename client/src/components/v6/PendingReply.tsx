import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { formatDateTimeInZone } from "@/lib/dates";
import { Button } from "@/components/ui/button";

/**
 * A reply that will be written later.
 *
 * The banner sits under the transcript: one sentence about when they
 * usually look at their phone, and a button to skip the wait this time.
 */
export default function PendingReply(props: {
  personaId: number;
  name: string;
  onArrived: () => void;
}) {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const timezone = (user as { timezone?: string | null } | undefined)?.timezone ?? null;
  const onArrivedRef = useRef(props.onArrived);
  onArrivedRef.current = props.onArrived;
  const hadJob = useRef(false);
  const pending = trpc.chat.pendingReply.useQuery(
    { personaId: props.personaId },
    {
      enabled: props.personaId > 0,
      refetchInterval: 15_000,
      refetchIntervalInBackground: false,
    },
  );
  const replyNow = trpc.chat.replyNow.useMutation({
    onSuccess: () => {
      void pending.refetch();
      onArrivedRef.current();
    },
  });
  const refetchPending = pending.refetch;

  useEffect(() => {
    if (pending.data) hadJob.current = true;
    else if (hadJob.current && pending.data === null && !pending.isLoading) {
      hadJob.current = false;
      onArrivedRef.current();
    }
  }, [pending.data, pending.isLoading]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type !== "navigate") return;
      void refetchPending();
      onArrivedRef.current();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [refetchPending]);

  if (pending.isError) {
    return (
      <div className="px-1 py-2 text-xs text-muted-foreground">
        <p>{t("common.error")}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void pending.refetch()}
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const job = pending.data;
  if (!job) return null;

  const time = formatDateTimeInZone(job.dueAt, locale, timezone);
  const line = job.reason === "asleep"
    ? t("chat.pendingAsleep", { name: props.name, time })
    : job.reason === "busy"
      ? t("chat.pendingBusy", { name: props.name, title: job.title || "—", time })
      : t("chat.pendingDelay", { name: props.name, time });

  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2 text-xs text-muted-foreground">
      <p className="leading-relaxed">{line}</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        disabled={replyNow.isPending}
        onClick={() => replyNow.mutate({ personaId: props.personaId })}
      >
        {t("chat.replyNow")}
      </Button>
    </div>
  );
}
