/**
 * Asking the other person (C10.3).
 *
 * The product promises the modelled person's consent. This is where the
 * owner asks: a self-contained page they can send, or a link on this
 * instance. Whatever the answer is, it is recorded here — and "no" is
 * enforced, not decorative: the chat closes and the only thing left is
 * the hard delete.
 *
 * The component is mounted on the profile page. It handles the three
 * states every request has: loading, failed (with a retry) and empty.
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ConsentStatus = "not_asked" | "asked_yes" | "asked_no" | "cannot_ask";

const STATUSES: ConsentStatus[] = ["not_asked", "asked_yes", "asked_no", "cannot_ask"];

function statusKeyOf(status: ConsentStatus) {
  if (status === "asked_yes") return "consent.statusAskedYes" as const;
  if (status === "asked_no") return "consent.statusAskedNo" as const;
  if (status === "cannot_ask") return "consent.statusCannotAsk" as const;
  return "consent.statusNotAsked" as const;
}

export default function ConsentTools({
  personaId,
  name,
  onPurged,
}: {
  personaId: number;
  name: string;
  onPurged?: () => void;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const status = trpc.consent.status.useQuery({ personaId });
  const setStatus = trpc.consent.setStatus.useMutation({
    onSuccess: () => {
      status.refetch();
      toast.success(t("consent.statusSaved"));
    },
  });
  const [draftStatus, setDraftStatus] = useState<ConsentStatus | null>(null);
  const [linkPath, setLinkPath] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const exportPage = trpc.consent.exportPage.useQuery({ personaId }, { enabled: false });
  const createLink = trpc.consent.createLink.useMutation();
  const purge = trpc.persona.purgeForConsent.useMutation({
    onSuccess: () => {
      toast.success(t("consent.purged"));
      setPurgeOpen(false);
      void utils.persona.list.invalidate();
      status.refetch();
      onPurged?.();
    },
  });

  async function downloadPage() {
    try {
      const result = await exportPage.refetch();
      if (!result.data) throw new Error("no page");
      const blob = new Blob([result.data.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mirrai-consent-${personaId}.html`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("consent.exportFailed"));
    }
  }

  async function generateLink() {
    const result = await createLink.mutateAsync({ personaId });
    const absolute = `${window.location.origin}${result.path}`;
    setLinkPath(absolute);
    setLinkExpiresAt(result.expiresAt);
    try {
      await navigator.clipboard.writeText(absolute);
    } catch {
      // Copying is a convenience; the link is on screen below either way.
    }
  }

  if (status.isLoading) {
    return (
      <section className="surface p-5 sm:p-6" aria-busy="true">
        <h2 className="section-title">{t("consent.settingTitle")}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t("common.loading")}</p>
      </section>
    );
  }

  if (status.isError || !status.data) {
    /**
     * A failure is not "nobody has asked yet".
     *
     * Rendering the empty state here would tell the owner the person has
     * not said no when the truth is that nobody knows.
     */
    return (
      <section className="surface p-5 sm:p-6" role="alert">
        <h2 className="section-title">{t("consent.settingTitle")}</h2>
        <p className="text-xs text-destructive mt-1">{t("common.loadFailed")}</p>
        <Button size="sm" variant="outline" className="mt-3 bg-transparent" onClick={() => status.refetch()}>
          {t("common.retry")}
        </Button>
      </section>
    );
  }

  const current = status.data.consent as ConsentStatus;
  const shown = draftStatus ?? current;

  return (
    <section className="surface p-5 sm:p-6">
      <h2 className="section-title">{t("consent.settingTitle")}</h2>
      <p className="text-xs text-muted-foreground mt-1 mb-4 leading-relaxed">
        {t("consent.settingBody")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("consent.statusLabel")}</span>
        <span className="text-sm text-foreground" role="status">{t(statusKeyOf(current), { name })}</span>
      </div>

      {status.data.link && (
        <p className="text-xs text-muted-foreground mt-1">
          {status.data.link.answeredAt
            ? t("consent.linkAnswered")
            : t("consent.linkExpires", {
                date: status.data.link.expiresAt.slice(0, 10),
              })}
        </p>
      )}

      <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-4">
        <p className="text-xs font-medium text-foreground/80 mb-1.5">
          {t("consent.askTitle", { name })}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          {t("consent.askBody", { name })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="bg-transparent"
            disabled={exportPage.isFetching}
            onClick={downloadPage}
          >
            {t("consent.exportPage")}
          </Button>
          <Button size="sm" variant="outline" className="bg-transparent" disabled={createLink.isPending} onClick={generateLink}>
            {t("consent.copyLink")}
          </Button>
        </div>
        {linkPath && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground mb-1">{t("consent.linkReady")}</p>
            <input
              readOnly
              value={linkPath}
              aria-label={t("consent.copyLink")}
              onFocus={(event) => event.currentTarget.select()}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs"
            />
            {linkExpiresAt && (
              <p className="text-xs text-muted-subtle mt-1">
                {t("consent.linkExpires", { date: linkExpiresAt.slice(0, 10) })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* What the owner records by hand, for the person they asked in person. */}
      <div className="mt-4">
        <Label className="text-xs text-muted-foreground" htmlFor="consent-status">
          {t("consent.statusChange")}
        </Label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <select
            id="consent-status"
            value={shown}
            onChange={(event) => setDraftStatus(event.target.value as ConsentStatus)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          >
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {t(statusKeyOf(item), { name })}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={setStatus.isPending || shown === current}
            onClick={() => {
              setStatus.mutate({ personaId, consent: shown });
              setDraftStatus(null);
            }}
          >
            {setStatus.isPending ? t("common.saving") : t("consent.saveStatus")}
          </Button>
        </div>
      </div>

      {current === "asked_no" && (
        <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-foreground">{t("consent.blockedCard", { name })}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t("consent.blockedBody")}</p>
          <Button size="sm" variant="destructive" className="mt-3" onClick={() => setPurgeOpen(true)}>
            {t("consent.purgeButton")}
          </Button>
        </div>
      )}

      <Dialog
        open={purgeOpen}
        onOpenChange={(open) => {
          setPurgeOpen(open);
          if (!open) {
            setConfirmName("");
            purge.reset();
          }
        }}
      >
        <DialogContent className="bg-card border-border rounded-lg max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{t("consent.purgeTitle")}</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              {t("consent.purgeBody", { name })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="consent-confirm-name">{t("consent.purgeNameLabel")}</Label>
            <Input
              id="consent-confirm-name"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPurgeOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={purge.isPending || confirmName.trim().length === 0}
              onClick={() => purge.mutate({ personaId, confirmName })}
            >
              {purge.isPending ? t("common.saving") : t("consent.purgeConfirm")}
            </Button>
          </DialogFooter>
          {purge.isError && (
            <p className="text-xs text-destructive" role="alert">
              {purge.error.message}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
