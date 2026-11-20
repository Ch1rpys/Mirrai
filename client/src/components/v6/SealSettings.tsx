import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * Sealing a persona until a day the user picks (C6.2).
 *
 * A seal is the user's own agreement, not a punishment: the data stays
 * exportable and deletable, and the controls to lift it are always
 * reachable. There is no reminder and no countdown.
 */
export default function SealSettings({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery({ id: personaId });
  const invalidate = () => {
    settings.refetch();
    utils.persona.get.invalidate();
  };
  const utils = trpc.useUtils();
  const setSeal = trpc.persona.seal.set.useMutation({
    onSuccess: () => {
      toast.success(t("seal.saved"));
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const requestOpen = trpc.persona.seal.requestOpen.useMutation({
    onSuccess: () => {
      toast.success(t("seal.requested", { date: settings.data?.seal?.until ?? "" }));
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const cancelRequest = trpc.persona.seal.cancelRequest.useMutation({
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(error.message),
  });

  const seal = settings.data?.seal;
  const [until, setUntil] = useState(seal?.until ?? "");
  const [earlyOpen, setEarlyOpen] = useState<"never" | "cooling">(seal?.earlyOpen ?? "never");

  useEffect(() => {
    setUntil(seal?.until ?? "");
    setEarlyOpen(seal?.earlyOpen ?? "never");
  }, [seal?.until, seal?.earlyOpen]);

  if (settings.isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (settings.isError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("seal.loadFailed")}{" "}
        <button type="button" onClick={() => settings.refetch()} className="underline underline-offset-2">
          {t("common.retry")}
        </button>
      </p>
    );
  }

  if (seal?.until) {
    const requestedAt = seal.requestedAt ? new Date(seal.requestedAt) : null;
    const opensAfter = requestedAt
      ? new Date(requestedAt.getTime() + 72 * 60 * 60 * 1000)
      : null;
    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground">{t("seal.title")}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("seal.enabled", { date: seal.until })}
        </p>
        {requestedAt && opensAfter && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("seal.requested", {
              date: opensAfter.toISOString().slice(0, 10),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {seal.earlyOpen === "cooling" && !requestedAt && (
            <Button size="sm" variant="outline" onClick={() => requestOpen.mutate({ personaId })}>
              {t("seal.request")}
            </Button>
          )}
          {requestedAt && (
            <Button size="sm" variant="ghost" onClick={() => cancelRequest.mutate({ personaId })}>
              {t("seal.cancelRequest")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={setSeal.isPending}
            onClick={() => setSeal.mutate({ personaId, until: null })}
          >
            {t("seal.open")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground">{t("seal.title")}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("seal.note")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="seal-until" className="text-xs text-muted-foreground">{t("seal.until")}</Label>
        <Input
          id="seal-until"
          type="date"
          value={until}
          onChange={(event) => setUntil(event.target.value)}
          className="w-44"
        />
      </div>
      <div className="space-y-1 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="seal-early"
            checked={earlyOpen === "never"}
            onChange={() => setEarlyOpen("never")}
          />
          {t("seal.never")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="seal-early"
            checked={earlyOpen === "cooling"}
            onChange={() => setEarlyOpen("cooling")}
          />
          {t("seal.cooling")}
        </label>
      </div>
      <Button
        size="sm"
        disabled={setSeal.isPending}
        onClick={() => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
            toast.error(t("seal.dateFirst"));
            return;
          }
          setSeal.mutate({ personaId, until, earlyOpen });
        }}
      >
        {t("seal.save")}
      </Button>
    </div>
  );
}
