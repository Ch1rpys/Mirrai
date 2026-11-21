import { Lock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import PersonaUnlockForm from "./PersonaUnlockForm";

/**
 * The whole page a locked persona shows (C8.4).
 *
 * The chat page used to answer a locked persona with the generic "something
 * went wrong, try again" panel — a retry button that could never work.
 * The PIN is the way forward here, and the page says so.
 */
export default function PersonaLockGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  return (
    <div className="min-h-dvh w-full flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm surface p-6 text-center">
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Lock className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="font-display text-lg font-semibold text-foreground">{t("personaUnlock.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1 mb-5 leading-relaxed">
          {t("personaUnlock.description")}
        </p>
        <PersonaUnlockForm
          onUnlocked={() => {
            void utils.invalidate();
            onUnlocked();
          }}
        />
      </div>
    </div>
  );
}
