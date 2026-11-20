/**
 * The memorial switch (C7.1).
 *
 * Turning it on changes what the app does around this persona: it never
 * suggests a goodbye, it never speaks first, the anniversary reminders
 * become the birthday and the day they died, and the prompt gains one
 * guard about not claiming a present life.
 *
 * The dates are optional. A birthday or a deathday that is set is shown
 * quietly in the hall on the day itself; nothing is pushed.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function dateOnly(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

export default function MemorialSettings({
  personaId,
  name,
}: {
  personaId: number;
  name: string;
}) {
  const { t } = useLocale();
  const settings = trpc.persona.getSettings.useQuery({ id: personaId });
  const [birthday, setBirthday] = useState<string | null>(null);
  const [deathday, setDeathday] = useState<string | null>(null);

  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => {
      toast.success(t("memorial.saved"));
      settings.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const enabled = settings.data?.mode === "memorial";
  const storedBirthday = birthday ?? dateOnly(settings.data?.memorial?.birthday);
  const storedDeathday = deathday ?? dateOnly(settings.data?.memorial?.deathday);

  const saveDates = (next: { birthday?: string | null; deathday?: string | null }) => {
    update.mutate({
      id: personaId,
      patch: {
        memorial: {
          birthday: next.birthday === undefined ? storedBirthday || null : next.birthday,
          deathday: next.deathday === undefined ? storedDeathday || null : next.deathday,
        },
      },
    });
  };

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={update.isPending}
          onChange={(event) =>
            update.mutate({
              id: personaId,
              patch: { mode: event.target.checked ? "memorial" : "default" },
            })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block">{t("memorial.title")}</span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            {t("memorial.note", { name })}
          </span>
        </span>
      </label>

      {enabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="memorial-birthday" className="text-xs text-muted-foreground">
              {t("memorial.birthday")}
            </Label>
            <Input
              id="memorial-birthday"
              type="date"
              value={storedBirthday}
              disabled={update.isPending}
              onChange={(event) => {
                setBirthday(event.target.value);
                saveDates({ birthday: event.target.value || null });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="memorial-deathday" className="text-xs text-muted-foreground">
              {t("memorial.deathday")}
            </Label>
            <Input
              id="memorial-deathday"
              type="date"
              value={storedDeathday}
              disabled={update.isPending}
              onChange={(event) => {
                setDeathday(event.target.value);
                saveDates({ deathday: event.target.value || null });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
