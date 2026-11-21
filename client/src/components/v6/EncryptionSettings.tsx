import { useId, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The encrypted database's settings (C8.5).
 *
 * Three states, one panel:
 *
 * - **off**: a password and the two acknowledgements. The button is
 *   disabled until a full backup exists, because the backup is the only
 *   way back if the password and the recovery code are both lost.
 * - **migrating**: the background job that encrypts (or writes back the
 *   plaintext of) every existing row; the panel shows how far it has
 *   got and polls until it is done.
 * - **on**: the key's state in this session (unlock / lock now), the
 *   recovery code's password reset, and turning it off again.
 *
 * The recovery code is shown by the enable mutation's response exactly
 * once; it is never available from `status`.
 */
export default function EncryptionSettings() {
  const { t } = useLocale();
  const id = useId();
  const status = trpc.encryption.status.useQuery(undefined, {
    retry: false,
    // While the row job runs, the progress is on the server; poll it.
    refetchInterval: (query) =>
      query.state.data?.migrating ? 2_000 : false,
  });
  const enable = trpc.encryption.enable.useMutation();
  const disable = trpc.encryption.disable.useMutation();
  const unlock = trpc.encryption.unlock.useMutation();
  const lock = trpc.encryption.lock.useMutation();
  const recover = trpc.encryption.recover.useMutation();

  const [password, setPassword] = useState("");
  const [lostUnderstood, setLostUnderstood] = useState(false);
  const [restartUnderstood, setRestartUnderstood] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryShown, setRecoveryShown] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const data = status.data;

  async function run(work: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      setPassword("");
      await status.refetch();
      toast.success(success);
    } catch (error) {
      toast.error((error as Error).message || t("encryption.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (status.isError) {
    return (
      <section className="surface p-5 sm:p-6">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("encryption.title")}
        </h2>
        <p className="text-sm text-muted-foreground mt-2 mb-4">{t("encryption.loadFailed")}</p>
        <Button
          variant="outline"
          className="rounded-md bg-transparent"
          onClick={() => status.refetch()}
        >
          {t("encryption.retry")}
        </Button>
      </section>
    );
  }

  const migration = data?.migration ?? null;
  const progressLine = migration
    ? migration.direction === "encrypt"
      ? t("encryption.progress", { done: migration.done, total: migration.total })
      : t("encryption.progressDecrypt", { done: migration.done, total: migration.total })
    : null;

  return (
    <section className="surface p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("encryption.title")}
        </h2>
        <p className="kicker mt-1.5">{data?.enabled ? t("encryption.statusOn") : t("encryption.statusOff")}</p>
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">{t("encryption.loading")}</p>
      ) : !data.enabled ? (
        <div className="space-y-4 max-w-lg">
          <p className="text-sm text-muted-foreground">{t("encryption.description")}</p>
          {!data.hasFullBackup ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">{t("encryption.backupNeeded")}</p>
          ) : null}
          <div>
            <Label htmlFor={`${id}-enable-password`} className="text-sm text-foreground/80">
              {t("encryption.passwordLabel")}
            </Label>
            <Input
              id={`${id}-enable-password`}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="h-9 rounded-md mt-1"
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-foreground/85">
            <input
              type="checkbox"
              className="mt-1"
              checked={lostUnderstood}
              onChange={(event) => setLostUnderstood(event.target.checked)}
            />
            <span>{t("encryption.understandLost")}</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-foreground/85">
            <input
              type="checkbox"
              className="mt-1"
              checked={restartUnderstood}
              onChange={(event) => setRestartUnderstood(event.target.checked)}
            />
            <span>{t("encryption.understandRestart")}</span>
          </label>
          <Button
            type="button"
            className="rounded-md"
            disabled={busy || !password || !lostUnderstood || !restartUnderstood || !data.hasFullBackup}
            onClick={() => {
              void (async () => {
                if (busy) return;
                setBusy(true);
                try {
                  const result = await enable.mutateAsync({
                    password,
                    lostContentUnderstood: true,
                    restartUnderstood: true,
                  });
                  setPassword("");
                  setRecoveryShown(result.recoveryCode);
                  setLostUnderstood(false);
                  setRestartUnderstood(false);
                  await status.refetch();
                  toast.success(t("encryption.enabled"));
                } catch (error) {
                  toast.error((error as Error).message || t("encryption.failed"));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {busy ? t("encryption.enabling") : t("encryption.enable")}
          </Button>

          {recoveryShown ? (
            <div className="border border-border rounded-md p-3 space-y-2">
              <p className="text-sm font-medium text-foreground">{t("encryption.recoveryTitle")}</p>
              <code className="block text-sm font-mono break-all select-all">{recoveryShown}</code>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-md bg-transparent"
                  onClick={() => {
                    void navigator.clipboard?.writeText(recoveryShown).then(
                      () => toast.success(t("encryption.recoveryCopied")),
                      () => toast.error(t("encryption.failed")),
                    );
                  }}
                >
                  {t("encryption.recoveryCopy")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-md"
                  onClick={() => setRecoveryShown(null)}
                >
                  {t("encryption.recoveryDone")}
                </Button>
              </div>
            </div>
          ) : null}

          {progressLine ? <p className="text-xs text-muted-foreground">{progressLine}</p> : null}
          <p className="text-xs text-muted-foreground">{t("encryption.filesNote")}</p>
        </div>
      ) : (
        <div className="space-y-5 max-w-lg">
          <p className="text-sm text-muted-foreground">{data.unlocked ? t("encryption.unlocked") : t("encryption.locked")}</p>
          {progressLine ? (
            <p className="text-xs text-muted-foreground">{progressLine}</p>
          ) : null}
          {migration?.error ? (
            <p className="text-sm text-red-700 dark:text-red-400">
              {t("encryption.migrationError", { message: migration.error })}
            </p>
          ) : null}

          {!data.unlocked ? (
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => unlock.mutateAsync({ password }), t("encryption.unlocked"));
              }}
            >
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                aria-label={t("encryption.passwordLabel")}
                className="h-9 rounded-md"
              />
              <Button type="submit" variant="outline" className="rounded-md bg-transparent" disabled={busy || !password}>
                <KeyRound className="w-3.5 h-3.5" />
                {t("encryption.unlock")}
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="rounded-md bg-transparent"
              disabled={busy}
              onClick={() => {
                void run(() => lock.mutateAsync(), t("encryption.locked"));
              }}
            >
              <Lock className="w-3.5 h-3.5" />
              {t("encryption.lockNow")}
            </Button>
          )}

          {data.hasRecoveryCode ? (
            <div className="border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground mb-2">{t("encryption.recoveryResetTitle")}</p>
              <div className="space-y-2">
                <Input
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  aria-label={t("encryption.recoveryCodeLabel")}
                  placeholder={t("encryption.recoveryCodeLabel")}
                  className="h-9 rounded-md"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    aria-label={t("encryption.newPasswordLabel")}
                    placeholder={t("encryption.newPasswordLabel")}
                    className="h-9 rounded-md"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-md bg-transparent"
                    disabled={busy || !recoveryCode || newPassword.length < 8}
                    onClick={() => {
                      void (async () => {
                        if (busy) return;
                        setBusy(true);
                        try {
                          await recover.mutateAsync({ recoveryCode, newPassword });
                          setRecoveryCode("");
                          setNewPassword("");
                          await status.refetch();
                          toast.success(t("encryption.resetDone"));
                        } catch (error) {
                          toast.error((error as Error).message || t("encryption.failed"));
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    {t("encryption.resetPassword")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground mb-1">{t("encryption.disableTitle")}</p>
            <p className="text-xs text-muted-foreground mb-2">
              {data.migrating ? t("encryption.migrationRunning") : t("encryption.disableHint")}
            </p>
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  if (busy) return;
                  setBusy(true);
                  try {
                    await disable.mutateAsync({ password });
                    setPassword("");
                    await status.refetch();
                    toast.success(t("encryption.disabled"));
                  } catch (error) {
                    toast.error((error as Error).message || t("encryption.failed"));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                aria-label={t("encryption.passwordLabel")}
                className="h-9 rounded-md"
              />
              <Button
                type="submit"
                variant="outline"
                className="rounded-md bg-transparent"
                disabled={busy || !password || data.migrating}
              >
                {busy ? t("encryption.disabling") : t("encryption.disable")}
              </Button>
            </form>
          </div>

          <p className="text-xs text-muted-foreground">{t("encryption.filesNote")}</p>
        </div>
      )}
    </section>
  );
}
