import { useEffect, useId, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { toast } from "sonner";
import { KeyRound, Lock, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * The app lock's settings (C8.4).
 *
 * One PIN per account, an idle window, and optional passkeys. Turning
 * the lock off throws the PIN and the passkeys away together — a PIN
 * left behind would silently come back the next time a persona was
 * locked, which is exactly the kind of surprise a lock must not have.
 *
 * Everything here is a write the server checks: the PIN is four to
 * eight digits and hashed, every save needs the account password, and a
 * passkey can only be registered while the app is open.
 */
export default function AppLockSettings() {
  const { t } = useLocale();
  const id = useId();
  const status = trpc.lock.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const savePin = trpc.lock.setPin.useMutation();
  const updateSettings = trpc.lock.updateSettings.useMutation();
  const disable = trpc.lock.disable.useMutation();
  const registerOptions = trpc.lock.passkey.registerOptions.useMutation();
  const registerVerify = trpc.lock.passkey.registerVerify.useMutation();
  const removePasskey = trpc.lock.passkey.remove.useMutation();

  const [pin, setPinValue] = useState("");
  const [password, setPassword] = useState("");
  const [idleMinutes, setIdleMinutes] = useState("5");
  const [busy, setBusy] = useState(false);

  const data = status.data;
  useEffect(() => {
    if (data) setIdleMinutes(String(data.idleMinutes));
  }, [data?.idleMinutes]);

  const supported = browserSupportsWebAuthn();

  async function run(work: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      setPinValue("");
      setPassword("");
      await status.refetch();
      toast.success(success);
    } catch (error) {
      toast.error((error as Error).message || t("appLock.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (status.isError) {
    return (
      <section className="surface p-5 sm:p-6">
        <div className="mb-1">
          <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
            {t("appLock.title")}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{t("appLock.loadFailed")}</p>
        <Button variant="outline" className="rounded-md bg-transparent" onClick={() => status.refetch()}>
          {t("common.retry")}
        </Button>
      </section>
    );
  }

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("appLock.title")}
        </h2>
        <p className="kicker mt-1.5">{t("appLock.description")}</p>
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">{t("appLock.loading")}</p>
      ) : !data.hasPin ? (
        <form
          className="space-y-3 max-w-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => savePin.mutateAsync({ pin, currentPassword: password }),
              t("appLock.saved"),
            );
          }}
        >
          <div>
            <Label htmlFor={`${id}-pin`} className="text-sm text-foreground/80">
              {t("appLock.pinLabel")}
            </Label>
            <Input
              id={`${id}-pin`}
              value={pin}
              onChange={(event) => setPinValue(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              maxLength={8}
              autoComplete="off"
              className="h-9 rounded-md mt-1"
            />
          </div>
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
          <Button type="submit" className="rounded-md" disabled={busy || pin.length < 4 || !password}>
            <Lock className="w-3.5 h-3.5" />
            {t("appLock.setPinAndEnable")}
          </Button>
        </form>
      ) : (
        <div className="space-y-5 max-w-lg">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">{t("appLock.enable")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("appLock.statusOn")}</p>
            </div>
            <Switch
              checked={data.enabled}
              aria-label={t("appLock.enable")}
              onCheckedChange={(next) => {
                void run(
                  () => updateSettings.mutateAsync({ enabled: next }),
                  t("appLock.saved"),
                );
              }}
            />
          </div>

          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor={`${id}-idle`} className="text-sm text-foreground/80">
                {t("appLock.idleLabel")}
              </Label>
              <Input
                id={`${id}-idle`}
                type="number"
                min={1}
                max={60}
                value={idleMinutes}
                onChange={(event) => setIdleMinutes(event.target.value)}
                className="h-9 rounded-md mt-1 w-24"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-md bg-transparent"
              disabled={busy}
              onClick={() => {
                const minutes = Number(idleMinutes);
                if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
                  toast.error(t("appLock.failed"));
                  return;
                }
                void run(
                  () => updateSettings.mutateAsync({ idleMinutes: minutes }),
                  t("appLock.saved"),
                );
              }}
            >
              {t("appLock.save")}
            </Button>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground mb-1">{t("appLock.changePin")}</p>
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => savePin.mutateAsync({ pin, currentPassword: password }),
                  t("appLock.saved"),
                );
              }}
            >
              <Input
                value={pin}
                onChange={(event) => setPinValue(event.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                maxLength={8}
                autoComplete="off"
                aria-label={t("appLock.pinLabel")}
                className="h-9 rounded-md"
              />
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                aria-label={t("appLock.passwordLabel")}
                className="h-9 rounded-md"
              />
              <Button type="submit" variant="outline" className="rounded-md bg-transparent" disabled={busy || pin.length < 4 || !password}>
                {t("appLock.save")}
              </Button>
            </form>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground mb-1">
              {t("appLock.passkeys")}
            </p>
            {(data.passkeys ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground mb-2">{t("appLock.noPasskeys")}</p>
            ) : (
              <ul className="space-y-2 mb-3">
                {(data.passkeys ?? []).map((passkey) => (
                  <li key={passkey.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-1.5 text-foreground/85">
                      <KeyRound className="w-3.5 h-3.5" />
                      {passkey.label || t("appLock.passkey")}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-md"
                      aria-label={t("appLock.removePasskey")}
                      disabled={busy}
                      onClick={() => {
                        void run(
                          () => removePasskey.mutateAsync({ id: passkey.id }),
                          t("appLock.passkeyRemoved"),
                        );
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t("appLock.removePasskey")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              className="rounded-md bg-transparent"
              disabled={!supported || busy}
              onClick={() => {
                void run(async () => {
                  const options = await registerOptions.mutateAsync();
                  const response = await startRegistration({ optionsJSON: options as never });
                  await registerVerify.mutateAsync({ response });
                }, t("appLock.passkeyAdded"));
              }}
            >
              <KeyRound className="w-3.5 h-3.5" />
              {supported ? t("appLock.addPasskey") : t("appLock.passkeyUnsupported")}
            </Button>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground mb-1">{t("appLock.disable")}</p>
            <p className="text-xs text-muted-foreground mb-2">{t("appLock.disableHint")}</p>
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => disable.mutateAsync({ currentPassword: password }),
                  t("appLock.disabled"),
                );
              }}
            >
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                aria-label={t("appLock.passwordLabel")}
                className="h-9 rounded-md"
              />
              <Button type="submit" variant="outline" className="rounded-md bg-transparent" disabled={busy || !password}>
                {t("appLock.disable")}
              </Button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
