import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/**
 * The long-distance section (C5.1).
 *
 * One date: the next time the two of them will be in the same place.
 * Nothing is pushed and nothing is counted down anywhere except on the
 * chat page. A date that has passed is cleared by answering one
 * question, not by a reminder.
 */
export default function LdrSettings({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery({ id: personaId });
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => settings.refetch(),
    onError: (error: { message: string }) => toast.error(error.message),
  });

  const stored = settings.data?.ldr?.nextMeetAt ?? "";
  const [date, setDate] = useState(stored);

  useEffect(() => {
    setDate(stored);
  }, [stored]);

  function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error(t("ldr.dateFirst"));
      return;
    }
    update.mutate(
      { id: personaId, patch: { ldr: { nextMeetAt: date } } },
      {
        onSuccess: () => toast.success(t("ldr.saved")),
      },
    );
  }

  function clear() {
    update.mutate(
      { id: personaId, patch: { ldr: { nextMeetAt: null } } },
      {
        onSuccess: () => toast.success(t("ldr.cleared")),
      },
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="section-title">{t("ldr.sectionTitle")}</h2>
        <p className="text-muted-foreground text-sm mt-1">{t("ldr.sectionHint")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ldr-next-meet" className="text-xs text-muted-foreground">
          {t("ldr.nextMeet")}
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="ldr-next-meet"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-44"
          />
          <Button size="sm" onClick={save} disabled={update.isPending}>
            {t("ldr.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={update.isPending || !stored}>
            {t("ldr.clear")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("ldr.nextMeetHint")}</p>
      </div>
    </div>
  );
}
