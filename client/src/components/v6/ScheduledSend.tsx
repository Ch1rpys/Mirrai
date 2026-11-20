import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/**
 * "Send later" from the chat (C5.3).
 *
 * One line and a day. On that day it enters the conversation as
 * something the user said, and the persona answers as usual. The dialog
 * is opened from the chat's more menu; nothing about it is automatic.
 */
export default function ScheduledSend({
  personaId,
  name,
  open,
  onClose,
}: {
  personaId: number;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const [help, setHelp] = useState<string | null>(null);
  const create = trpc.scheduled.create.useMutation({
    onSuccess: (result) => {
      if (!result.created) {
        setHelp((result as { help?: string }).help ?? null);
        return;
      }
      utils.scheduled.list.invalidate({ personaId });
      toast.success(t("scheduled.created"));
      setBody("");
      setWhen("");
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  if (!open) return null;

  const submit = () => {
    if (!body.trim() || !when) {
      toast.error(t("scheduled.dateFirst"));
      return;
    }
    const at = new Date(when);
    if (!Number.isFinite(at.getTime())) {
      toast.error(t("scheduled.dateFirst"));
      return;
    }
    create.mutate({ personaId, kind: "message", body: body.trim(), dueAt: at.toISOString() });
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("scheduled.sendTitle")}
        className="surface relative w-full max-w-md p-5 space-y-3"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="section-title">{t("scheduled.sendTitle")}</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("scheduled.sendHint", { name })}
        </p>
        {help ? (
          <>
            <p className="kicker">{t("scheduled.crisisTitle")}</p>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{help}</p>
            <Button size="sm" onClick={onClose}>{t("common.close")}</Button>
          </>
        ) : (
          <>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t("scheduled.messagePlaceholder")}
              rows={4}
            />
            <div className="space-y-1.5">
              <Label htmlFor="scheduled-due" className="text-xs text-muted-foreground">
                {t("scheduled.dateLabel")}
              </Label>
              <Input
                id="scheduled-due"
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={submit} disabled={create.isPending}>
                {t("scheduled.send")}
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
