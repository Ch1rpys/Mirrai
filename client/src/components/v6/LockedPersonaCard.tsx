import { useState } from "react";
import { Lock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import PersonaUnlockForm from "./PersonaUnlockForm";

/**
 * A locked persona's place in the lobby (C8.4).
 *
 * The server already sends no name and no face for it, so this card is
 * not a mask over the real one — there is nothing behind it to find in
 * the page source. Unlocking proves the PIN and refreshes the lobby,
 * which then brings the real card back.
 */
export default function LockedPersonaCard({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  return (
    <div className="surface p-5 animate-fade-in-up">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Lock className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-sans text-base font-semibold text-foreground">
            {t("lobby.card.locked")}
          </p>
          <p className="text-sm text-muted-foreground mt-1">{t("personaUnlock.needed")}</p>
          <button
            type="button"
            className="mt-3 text-sm font-medium text-cinnabar hover:underline"
            onClick={() => setOpen(true)}
          >
            {t("lobby.card.unlock")}
          </button>
        </div>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-foreground/20" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("personaUnlock.title")}
            className="fixed left-1/2 top-1/2 z-50 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 surface p-5"
          >
            <h2 className="font-display text-base font-semibold text-foreground mb-1">
              {t("personaUnlock.title")}
            </h2>
            <p className="text-xs text-muted-foreground mb-4">{t("personaUnlock.description")}</p>
            <PersonaUnlockForm
              autoFocus
              onUnlocked={() => {
                setOpen(false);
                // The list and the chat both read the persona; refresh
                // whatever is on screen.
                void utils.invalidate();
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
