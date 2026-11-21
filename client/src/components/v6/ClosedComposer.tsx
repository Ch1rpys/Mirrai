/**
 * The composer while the user's own step-down closes the chat (C6.1).
 *
 * When the taper is at "weekends only" or "letters only" — or the
 * persona is sealed — the input is not there to be typed into and then
 * refused. What is there is the reason, one way to make an exception
 * today, and the support entrance, which is never removed.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { copy } from "@shared/copy";
import { zonedDateKey } from "@shared/timezone";
import { Button } from "@/components/ui/button";
import CrisisCard from "@/components/CrisisCard";

export type ClosedReason = "weekend_only" | "letters_only" | "sealed";

export default function ClosedComposer({
  personaId,
  name,
  reason,
  onRefetch,
}: {
  personaId: number;
  name: string;
  reason: ClosedReason;
  onRefetch: () => void;
}) {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const timezone = (user as { timezone?: string | null } | undefined)?.timezone ?? null;
  const [showHelp, setShowHelp] = useState(false);
  const override = trpc.persona.updateSettings.useMutation({
    onSuccess: () => onRefetch(),
  });

  const key = reason === "weekend_only"
    ? "chat.closedWeekend"
    : reason === "letters_only"
      ? "chat.closedLettersOnly"
      : "chat.closedSealed";

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-3 space-y-2">
      <p className="text-xs text-muted-foreground leading-relaxed">
        {copy(locale, key, { name })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {reason === "weekend_only" && (
          <Button
            size="sm"
            variant="outline"
            className="bg-transparent"
            disabled={override.isPending}
            onClick={() =>
              override.mutate({
                id: personaId,
                patch: {
                  taper: {
                    overrideDay: zonedDateKey(new Date(), timezone),
                  },
                },
              })
            }
          >
            {t("chat.taperOverride")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setShowHelp(true)}>
          {t("chat.taperHelp")}
        </Button>
      </div>
      {showHelp && <CrisisCard onClose={() => setShowHelp(false)} />}
    </div>
  );
}
