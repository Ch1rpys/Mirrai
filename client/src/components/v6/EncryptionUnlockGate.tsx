import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearEncryptionLocked, useEncryptionLocked } from "@/lib/encryption-lock";

/**
 * The screen shown when the encrypted account's key is not in the server
 * process (C8.5).
 *
 * The key is unwrapped from the account password at sign-in and kept in
 * memory only. A restart forgets it while the session cookie still
 * works, so the interface asks once and puts everything back. It is
 * `main.tsx` that raises this screen: any request answering
 * `ENCRYPTION_LOCKED` marks the store, and the screen reads it.
 */
export default function EncryptionUnlockGate() {
  const locked = useEncryptionLocked();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const id = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const status = trpc.encryption.status.useQuery(undefined, {
    enabled: locked,
    retry: false,
  });
  const unlock = trpc.encryption.unlock.useMutation();

  useEffect(() => {
    if (!locked) return;
    const previous = document.title;
    document.title = t("encryptionGate.title");
    return () => {
      document.title = previous;
    };
  }, [locked, t]);

  if (!locked) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    try {
      await unlock.mutateAsync({ password });
      setPassword("");
      clearEncryptionLocked();
      // Everything the lock refused is worth asking again now.
      void queryClient.invalidateQueries();
    } catch (error) {
      toast.error((error as Error).message || t("encryptionGate.unlockFailed"));
    } finally {
      setBusy(false);
    }
  }

  const note = status.isError
    ? t("encryptionGate.unlockFailed")
    : status.isLoading
      ? t("encryptionGate.loading")
      : t("encryptionGate.note");

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <section className="surface w-full max-w-sm p-6">
        <div className="mb-4">
          <h1 className="font-display text-xl font-semibold text-foreground">
            {t("encryptionGate.title")}
          </h1>
          <p className="kicker mt-1.5">{t("encryptionGate.prompt")}</p>
        </div>
        <form className="space-y-3" onSubmit={submit}>
          <div>
            <Label htmlFor={`${id}-password`} className="text-sm text-foreground/80">
              {t("appLock.passwordLabel")}
            </Label>
            <Input
              id={`${id}-password`}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="h-9 rounded-md mt-1"
            />
          </div>
          <Button type="submit" className="rounded-md w-full" disabled={busy || !password}>
            <KeyRound className="w-3.5 h-3.5" />
            {t("encryptionGate.unlock")}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-3">{note}</p>
      </section>
    </div>
  );
}
