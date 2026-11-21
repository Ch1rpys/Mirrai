import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearAppLocked, markAppLocked, useAppLocked } from "@/lib/app-lock";

/**
 * The app lock's screen and its way out (C8.4).
 *
 * The server is what enforces the lock; this is what the person sees.
 * Three ways in: the PIN, the account password, a passkey. The screen is
 * rendered from the module store, which `main.tsx` fills whenever any
 * request answers `LOCKED` — so the lobby that was already in memory
 * disappears with it.
 */

/** How close together the two Escape presses have to be. */
const DOUBLE_ESCAPE_MS = 600;

function useOpenAgain() {
  const queryClient = useQueryClient();
  return () => {
    clearAppLocked();
    // Everything the lock refused is worth asking again now.
    void queryClient.invalidateQueries();
  };
}

/**
 * The lock screen itself.
 *
 * The heading says what is happening and nothing about the data behind
 * it; the page title goes neutral for the same reason — a tab that says
 * the persona's name is a label on a locked door.
 */
export function LockScreen() {
  const { t } = useLocale();
  const openAgain = useOpenAgain();
  const id = useId();
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const status = trpc.lock.status.useQuery(undefined, { retry: false });
  const verifyPin = trpc.lock.verifyPin.useMutation();
  const verifyPassword = trpc.lock.verifyPassword.useMutation();
  const authOptions = trpc.lock.passkey.authOptions.useMutation();
  const authVerify = trpc.lock.passkey.authVerify.useMutation();
  const passkeys = status.data?.passkeys ?? [];
  const canPasskey = passkeys.length > 0 && browserSupportsWebAuthn();

  useEffect(() => {
    const previous = document.title;
    document.title = t("lockScreen.lockedTitle");
    return () => {
      document.title = previous;
    };
  }, [t]);

  async function submitPin(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await verifyPin.mutateAsync({ pin });
      setPin("");
      openAgain();
    } catch (error) {
      toast.error((error as Error).message || t("lockScreen.wrong"));
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await verifyPassword.mutateAsync({ password });
      setPassword("");
      openAgain();
    } catch (error) {
      toast.error((error as Error).message || t("lockScreen.wrong"));
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithPasskey() {
    if (busy) return;
    setBusy(true);
    try {
      const options = await authOptions.mutateAsync();
      const response = await startAuthentication({ optionsJSON: options as never });
      await authVerify.mutateAsync({ response });
      openAgain();
    } catch (error) {
      toast.error((error as Error).message || t("lockScreen.passkeyFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
    >
      <div className="w-full max-w-sm surface p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="w-4 h-4 text-foreground/70" aria-hidden="true" />
          <h1 id={`${id}-title`} className="font-display text-xl font-semibold text-foreground">
            {t("lockScreen.title")}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          {mode === "pin" ? t("lockScreen.prompt") : t("lockScreen.passwordPrompt")}
        </p>

        {mode === "pin" ? (
          <form onSubmit={submitPin} className="space-y-3">
            <Label htmlFor={`${id}-pin`} className="sr-only">
              {t("lockScreen.pinLabel")}
            </Label>
            <Input
              id={`${id}-pin`}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={8}
              className="h-10 rounded-md text-center text-lg tracking-[0.4em]"
              aria-label={t("lockScreen.pinLabel")}
            />
            <Button type="submit" className="w-full rounded-md" disabled={busy || pin.length < 4}>
              {t("lockScreen.unlock")}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitPassword} className="space-y-3">
            <Label htmlFor={`${id}-password`} className="sr-only">
              {t("lockScreen.passwordLabel")}
            </Label>
            <Input
              id={`${id}-password`}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              className="h-10 rounded-md"
              aria-label={t("lockScreen.passwordLabel")}
            />
            <Button type="submit" className="w-full rounded-md" disabled={busy || !password}>
              {t("lockScreen.unlock")}
            </Button>
          </form>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {canPasskey && (
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-md bg-transparent"
              onClick={() => void unlockWithPasskey()}
              disabled={busy}
            >
              {t("lockScreen.usePasskey")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="w-full rounded-md text-sm"
            onClick={() => {
              setMode(mode === "pin" ? "password" : "pin");
              setPin("");
              setPassword("");
            }}
          >
            {mode === "pin" ? t("lockScreen.usePassword") : t("lockScreen.usePin")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The top bar's "hide it now" button.
 *
 * It only appears when the lock is actually switched on: a button that
 * does nothing is worse than no button. The same action is on a double
 * Escape in `AppLock`.
 */
export function LockNowButton() {
  const { t } = useLocale();
  const { isAuthenticated } = useAuth();
  const status = trpc.lock.status.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const lockNow = trpc.lock.lockNow.useMutation();
  if (!status.data?.enabled) return null;
  return (
    <button
      type="button"
      className="app-nav-icon"
      title={t("lockScreen.lockNow")}
      aria-label={t("lockScreen.lockNow")}
      onClick={() => {
        void lockNow.mutateAsync().finally(() => markAppLocked());
      }}
    >
      <Lock className="w-4 h-4" />
    </button>
  );
}

/**
 * The component mounted by the app shell.
 *
 * It renders nothing while the app is open. What it does there is listen
 * for the double Escape: the lock's "hide it now" shortcut is only worth
 * anything if it is reachable from the keyboard while the screen is
 * showing something it should not.
 */
export default function AppLock() {
  const { isAuthenticated } = useAuth();
  const locked = useAppLocked();
  const status = trpc.lock.status.useQuery(undefined, {
    enabled: isAuthenticated && !locked,
    refetchOnWindowFocus: false,
  });
  const lockNow = trpc.lock.lockNow.useMutation();

  useEffect(() => {
    if (locked || !status.data?.enabled) return;
    let lastEscape = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const now = Date.now();
      if (now - lastEscape <= DOUBLE_ESCAPE_MS) {
        lastEscape = 0;
        void lockNow.mutateAsync().finally(() => markAppLocked());
        return;
      }
      lastEscape = now;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [locked, status.data?.enabled, lockNow]);

  return locked ? <LockScreen /> : null;
}
