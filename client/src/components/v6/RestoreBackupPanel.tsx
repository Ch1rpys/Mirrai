import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Restoring a backup on the first-run page (C8.3).
 *
 * A restore replaces the whole database, so it is only offered while the
 * instance has no account at all. The component asks the server whether
 * that is the case and renders nothing when it is not — a page that is
 * already in use must not show a button that cannot work.
 *
 * The check itself has two different failures and they are said
 * differently: "this instance already has an account" is an answer, and
 * nothing is shown; "the answer could not be read" is a failure, and it
 * gets its own sentence and a way to try again.
 */

type Availability = "checking" | "available" | "unavailable" | "failed";

/** What the restore route answers: the success sentence, or the error's. */
type RestoreResponse = { ok?: unknown; message?: unknown; error?: unknown };

/** A passphrase as base64 of its UTF-8 bytes, for the request header. */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function RestoreBackupPanel() {
  const { t } = useLocale();
  const [availability, setAvailability] = useState<Availability>("checking");
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const check = useCallback(async () => {
    setAvailability("checking");
    try {
      const response = await fetch("/api/backup/available", { credentials: "include" });
      const body = response.ok
        ? ((await response.json()) as { available?: unknown } | null)
        : null;
      if (typeof body?.available !== "boolean") {
        // A 503 is "could not check", not "there is an account".
        setAvailability("failed");
        return;
      }
      setAvailability(body.available ? "available" : "unavailable");
    } catch {
      setAvailability("failed");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function restore() {
    setError(null);
    if (!file) {
      setError(t("restoreBackup.noFile"));
      return;
    }
    setBusy(true);
    setDone(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
      };
      if (passphrase) {
        // The passphrase goes in a header, not the URL: an access log must
        // not remember it.
        headers["x-mirrai-backup-passphrase"] = base64Utf8(passphrase);
      }
      const response = await fetch("/api/backup/restore", {
        method: "POST",
        credentials: "include",
        headers,
        body: bytes,
      });
      let body: RestoreResponse | null = null;
      try {
        body = (await response.json()) as RestoreResponse;
      } catch {
        // A body that is not JSON still leaves the status to decide.
      }
      if (!response.ok || body?.ok !== true) {
        setError(
          typeof body?.error === "string" && body.error
            ? body.error
            : t("restoreBackup.failed"),
        );
        return;
      }
      setDone(
        typeof body?.message === "string" && body.message
          ? body.message
          : t("restoreBackup.restored"),
      );
    } catch {
      setError(t("restoreBackup.networkFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (availability === "checking") {
    return (
      <p
        className="mt-10 text-center text-xs text-muted-foreground"
        data-testid="restore-checking"
      >
        {t("restoreBackup.checking")}
      </p>
    );
  }

  if (availability === "failed") {
    return (
      <div
        className="mt-10 flex flex-wrap items-center justify-center gap-3"
        data-testid="restore-check-failed"
      >
        <p className="text-xs text-destructive">{t("restoreBackup.checkFailed")}</p>
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={() => void check()}
        >
          {t("restoreBackup.retry")}
        </button>
      </div>
    );
  }

  // The instance already has an account: a backup cannot be restored here.
  if (availability === "unavailable") return null;

  return (
    <section
      className="mt-10 rounded-lg border border-border bg-card/60 p-5"
      data-testid="restore-backup-panel"
    >
      <h2 className="font-display text-base font-semibold text-foreground">
        {t("restoreBackup.title")}
      </h2>
      <p className="kicker mt-1.5">{t("restoreBackup.note")}</p>
      <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
        {t("restoreBackup.hint")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        {t("restoreBackup.warning")}
      </p>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="restore-backup-file" className="text-xs">
          {t("restoreBackup.chooseFile")}
        </Label>
        <input
          id="restore-backup-file"
          type="file"
          accept=".zip,.mirrai-backup"
          data-testid="restore-backup-file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setDone(null);
            setError(null);
          }}
          className="block w-full rounded-md border border-input bg-card px-2 py-1.5 text-xs text-foreground file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
        />
        {file && (
          <p className="text-xs text-muted-foreground" data-testid="restore-chosen-file">
            {t("restoreBackup.fileChosen", { name: file.name })}
          </p>
        )}
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="restore-backup-passphrase" className="text-xs">
          {t("restoreBackup.passphraseLabel")}
        </Label>
        <Input
          id="restore-backup-passphrase"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          placeholder={t("restoreBackup.passphrasePlaceholder")}
          autoComplete="current-password"
          className="h-9"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void restore()}
          disabled={busy}
          data-testid="restore-start"
        >
          {busy ? t("restoreBackup.starting") : t("restoreBackup.start")}
        </Button>
        {error && (
          <p className="text-xs text-destructive" role="alert" data-testid="restore-error">
            {error}
          </p>
        )}
      </div>

      {done && (
        <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3" data-testid="restore-done">
          <p className="text-sm text-foreground">{done}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("restoreBackup.goSignIn")}</p>
        </div>
      )}
    </section>
  );
}
