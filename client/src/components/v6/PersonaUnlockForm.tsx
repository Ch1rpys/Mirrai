import { useId, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The PIN form for a locked persona (C8.4).
 *
 * A persona lock is the same PIN as the app lock and demands it within
 * the last five minutes. The form is one small piece used by the lobby's
 * locked card and by the chat page's gate, so there is one place where
 * the PIN is entered and one place where the answer is handled.
 */
export default function PersonaUnlockForm({
  onUnlocked,
  autoFocus = false,
}: {
  onUnlocked: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const verifyPin = trpc.lock.verifyPin.useMutation();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await verifyPin.mutateAsync({ pin });
      setPin("");
      onUnlocked();
    } catch (error) {
      toast.error((error as Error).message || t("lockScreen.wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Label htmlFor={`${id}-pin`} className="sr-only">
        {t("lockScreen.pinLabel")}
      </Label>
      <Input
        id={`${id}-pin`}
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/[^0-9]/g, ""))}
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={8}
        aria-label={t("lockScreen.pinLabel")}
        className="h-9 rounded-md text-center tracking-[0.3em]"
      />
      <Button type="submit" className="w-full rounded-md" disabled={busy || pin.length < 4}>
        {t("lockScreen.unlock")}
      </Button>
    </form>
  );
}
