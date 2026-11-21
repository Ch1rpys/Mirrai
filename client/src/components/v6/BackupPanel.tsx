import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatInstantInZone } from "@/lib/dates";
import type { BackupFrequency, PublicBackupSettings } from "@shared/backup";
import { toast } from "sonner";

/**
 * The complete backup and its schedule (C8.3), in the settings' data tab.
 *
 * Two things live here, and they are separate on purpose:
 *
 *  - "download a full backup" encrypts everything this account has with a
 *    passphrase the user types now. The file cannot be opened without it,
 *    and nothing can recover it — the page says so before the button.
 *  - "scheduled backup" writes a copy on its own, to a folder on this
 *    machine, a WebDAV server or an S3-compatible bucket. A target beyond
 *    this machine must carry a passphrase: the file is encrypted in
 *    somebody else's storage.
 *
 * The three states a read can be in are kept apart, as everywhere else in
 * this tab: still loading, failed with a way to try again, and the real
 * answer — a user who has never run a backup is not a user whose settings
 * could not be read.
 */

type TargetKind = "folder" | "webdav" | "s3";

/**
 * What the form is allowed to send.
 *
 * The destination type is the public one — a secret never travels back to
 * the browser, only the flag that says one is stored.
 */
type UpdateInput = {
  enabled: boolean;
  frequency: BackupFrequency;
  target?: NonNullable<PublicBackupSettings["target"]>;
  passphrase?: string;
  targetPassword?: string;
  targetSecretAccessKey?: string;
};

/** Everything the form edits, including the fields that are write-only. */
interface Draft {
  enabled: boolean;
  frequency: BackupFrequency;
  targetKind: TargetKind;
  folderPath: string;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  s3Endpoint: string;
  s3Bucket: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Prefix: string;
  passphrase: string;
  hasPassphrase: boolean;
  hasTargetPassword: boolean;
  hasTargetSecretAccessKey: boolean;
}

/** The form as it starts from what the server knows. */
function draftFrom(settings: PublicBackupSettings): Draft {
  const target = settings.target;
  return {
    enabled: settings.enabled,
    frequency: settings.frequency,
    targetKind: target?.kind ?? "folder",
    folderPath: target?.kind === "folder" ? target.path : "",
    webdavUrl: target?.kind === "webdav" ? target.url : "",
    webdavUsername: target?.kind === "webdav" ? target.username : "",
    webdavPassword: "",
    s3Endpoint: target?.kind === "s3" ? target.endpoint : "",
    s3Bucket: target?.kind === "s3" ? target.bucket : "",
    s3Region: target?.kind === "s3" ? target.region : "",
    s3AccessKeyId: target?.kind === "s3" ? target.accessKeyId : "",
    s3SecretAccessKey: "",
    s3Prefix: target?.kind === "s3" ? (target.prefix ?? "") : "",
    passphrase: "",
    hasPassphrase: settings.hasPassphrase,
    hasTargetPassword: settings.hasTargetPassword,
    hasTargetSecretAccessKey: settings.hasTargetSecretAccessKey,
  };
}

/** The destination the form currently describes, or nothing when it is unfinished. */
function targetFrom(draft: Draft): NonNullable<PublicBackupSettings["target"]> | null {
  if (draft.targetKind === "folder") {
    const path = draft.folderPath.trim();
    return path ? { kind: "folder", path } : null;
  }
  if (draft.targetKind === "webdav") {
    const url = draft.webdavUrl.trim();
    const username = draft.webdavUsername.trim();
    return url && username ? { kind: "webdav", url, username } : null;
  }
  const endpoint = draft.s3Endpoint.trim();
  const bucket = draft.s3Bucket.trim();
  const region = draft.s3Region.trim();
  const accessKeyId = draft.s3AccessKeyId.trim();
  if (!endpoint || !bucket || !region || !accessKeyId) return null;
  const prefix = draft.s3Prefix.trim();
  return {
    kind: "s3",
    endpoint,
    bucket,
    region,
    accessKeyId,
    ...(prefix ? { prefix } : {}),
  };
}

/**
 * The file name the server chose, out of `Content-Disposition`.
 *
 * The route sets a plain quoted name; the RFC 5987 form is accepted too
 * so a non-ASCII name from a future server is not lost.
 */
function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return encoded[1];
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted) return quoted[1];
  const plain = /filename=([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/**
 * The last failure's sentence.
 *
 * The scheduler stores a token, not a sentence: the interface translates
 * it for whoever is reading. An unknown token is said as "the backup did
 * not finish" rather than shown raw.
 */
function lastErrorKey(token: string) {
  switch (token) {
    case "creation_failed":
      return "settings.data.backup.errors.creationFailed" as const;
    case "delivery_failed":
      return "settings.data.backup.errors.deliveryFailed" as const;
    case "missing_credentials":
      return "settings.data.backup.errors.missingCredentials" as const;
    case "s3_too_large":
      return "settings.data.backup.errors.s3TooLarge" as const;
    case "folder_missing":
      return "settings.data.backup.errors.folderMissing" as const;
    case "folder_write_failed":
      return "settings.data.backup.errors.folderWriteFailed" as const;
    case "http_failed":
      return "settings.data.backup.errors.httpFailed" as const;
    case "passphrase_missing":
      return "settings.data.backup.errors.passphraseMissing" as const;
    default:
      return "settings.data.backup.errors.backupFailed" as const;
  }
}

export default function BackupPanel() {
  const { t, locale } = useLocale();
  const { data, isLoading, isError, refetch } = trpc.backup.getSettings.useQuery();
  const [snapshot, setSnapshot] = useState<PublicBackupSettings | null>(() => data ?? null);
  const [draft, setDraft] = useState<Draft | null>(() => (data ? draftFrom(data) : null));
  const [downloadPassphrase, setDownloadPassphrase] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // The first answer fills the status line and the form. Nothing the user
  // has typed is overwritten, and a mock that hands back a fresh object on
  // every render cannot keep this updating (the updaters bail out when a
  // value is already set).
  useEffect(() => {
    if (!data) return;
    setSnapshot((current) => (current === null ? data : current));
    setDraft((current) => (current === null ? draftFrom(data) : current));
  }, [data]);

  const update = trpc.backup.updateSettings.useMutation({
    onSuccess: (saved: PublicBackupSettings) => {
      setFormError(null);
      // The save returns the settings as stored: the flags that say a
      // secret is set (and the last run) move to what the server says.
      setSnapshot(saved);
      setDraft(draftFrom(saved));
      toast.success(t("settings.data.backup.saved"));
    },
    onError: (error: { message: string }) => {
      setFormError(t("settings.data.backup.saveFailed", { message: error.message }));
    },
  });

  function patch(changes: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  async function download() {
    setDownloadError(null);
    if (downloadPassphrase.length < 8) {
      setDownloadError(t("settings.data.backup.passphraseTooShort"));
      return;
    }
    setDownloading(true);
    try {
      const response = await fetch("/api/backup/download", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: downloadPassphrase }),
      });
      if (!response.ok) {
        let message: string = t("settings.data.backup.downloadUnknownError");
        try {
          const body = (await response.json()) as { error?: unknown };
          if (typeof body?.error === "string" && body.error) message = body.error;
        } catch {
          // A failure with no JSON body still has the fallback sentence.
        }
        setDownloadError(t("settings.data.backup.downloadFailed", { message }));
        return;
      }
      const blob = await response.blob();
      const fileName =
        fileNameFromDisposition(response.headers.get("content-disposition")) ?? "mirrai-backup.zip";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setDownloadError(
        t("settings.data.backup.downloadFailed", {
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      setDownloading(false);
    }
  }

  function save() {
    if (!draft) return;
    setFormError(null);
    const target = targetFrom(draft);
    if (draft.enabled && !target) {
      setFormError(
        t(
          draft.targetKind === "folder"
            ? "settings.data.backup.targetRequired"
            : "settings.data.backup.targetIncomplete",
        ),
      );
      return;
    }
    if (draft.passphrase && draft.passphrase.length < 8) {
      setFormError(t("settings.data.backup.passphraseTooShort"));
      return;
    }
    // A destination beyond this machine must be encrypted; an unattended
    // run has nobody to ask for the passphrase later.
    if (
      draft.enabled &&
      draft.targetKind !== "folder" &&
      !draft.hasPassphrase &&
      draft.passphrase.length < 8
    ) {
      setFormError(t("settings.data.backup.remotePassphraseRequired"));
      return;
    }

    const input: UpdateInput = {
      enabled: draft.enabled,
      frequency: draft.frequency,
    };
    if (target) input.target = target;
    if (draft.passphrase) input.passphrase = draft.passphrase;
    if (draft.targetKind === "webdav" && draft.webdavPassword) {
      input.targetPassword = draft.webdavPassword;
    }
    if (draft.targetKind === "s3" && draft.s3SecretAccessKey) {
      input.targetSecretAccessKey = draft.s3SecretAccessKey;
    }
    update.mutate(input);
  }

  const selectClass =
    "h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]";
  const keepStored = t("settings.data.backup.keepStored");

  return (
    <section className="surface p-5 sm:p-6" data-testid="backup-panel">
      <div className="mb-5">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-foreground">
          {t("settings.data.backup.title")}
        </h2>
        <p className="kicker mt-1.5">{t("settings.data.backup.note")}</p>
      </div>

      {isLoading && !data && (
        <p className="text-xs text-muted-foreground" data-testid="backup-loading">
          {t("settings.data.backup.loading")}
        </p>
      )}

      {!isLoading && isError && (
        <div className="flex items-center gap-3" data-testid="backup-load-error">
          <p className="text-xs text-destructive">{t("settings.data.backup.loadFailed")}</p>
          <button
            type="button"
            className="text-xs underline underline-offset-2"
            onClick={() => void refetch()}
          >
            {t("settings.data.backup.retry")}
          </button>
        </div>
      )}

      {!isLoading && !isError && snapshot && draft && (
        <>
          {/* The one-off full download. */}
          <div
            className="rounded-md border border-border/60 p-4"
            data-testid="backup-download"
          >
            <p className="text-sm text-foreground leading-relaxed">
              {t("settings.data.backup.downloadDescription")}
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="backup-download-passphrase" className="text-xs">
                  {t("settings.data.backup.passphraseLabel")}
                </Label>
                <Input
                  id="backup-download-passphrase"
                  type="password"
                  value={downloadPassphrase}
                  onChange={(event) => setDownloadPassphrase(event.target.value)}
                  placeholder={t("settings.data.backup.passphrasePlaceholder")}
                  minLength={8}
                  autoComplete="new-password"
                  className="h-9 sm:w-64"
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void download()}
                disabled={downloading}
              >
                {downloading
                  ? t("settings.data.backup.downloading")
                  : t("settings.data.backup.download")}
              </Button>
            </div>
            {downloadError && (
              <p
                className="mt-2 text-xs text-destructive"
                role="alert"
                data-testid="backup-download-error"
              >
                {downloadError}
              </p>
            )}
          </div>

          {/* The schedule. */}
          <div
            className="mt-5 rounded-md border border-border/60 p-4"
            data-testid="backup-scheduled"
          >
            <h3 className="text-sm font-medium text-foreground">
              {t("settings.data.backup.scheduledTitle")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {t("settings.data.backup.scheduledNote")}
            </p>

            <div className="mt-4 flex items-center justify-between gap-4">
              <Label htmlFor="backup-enabled" className="text-sm">
                {t("settings.data.backup.enableSwitch")}
              </Label>
              <Switch
                id="backup-enabled"
                checked={draft.enabled}
                onCheckedChange={(next) => patch({ enabled: next })}
                aria-label={t("settings.data.backup.enableSwitch")}
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="backup-frequency" className="text-xs">
                  {t("settings.data.backup.frequencyLabel")}
                </Label>
                <select
                  id="backup-frequency"
                  className={selectClass}
                  value={draft.frequency}
                  onChange={(event) =>
                    patch({ frequency: event.target.value as BackupFrequency })
                  }
                >
                  <option value="daily">{t("settings.data.backup.frequencyDaily")}</option>
                  <option value="weekly">{t("settings.data.backup.frequencyWeekly")}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="backup-target-kind" className="text-xs">
                  {t("settings.data.backup.targetLabel")}
                </Label>
                <select
                  id="backup-target-kind"
                  className={selectClass}
                  value={draft.targetKind}
                  onChange={(event) => patch({ targetKind: event.target.value as TargetKind })}
                >
                  <option value="folder">{t("settings.data.backup.targetFolder")}</option>
                  <option value="webdav">{t("settings.data.backup.targetWebdav")}</option>
                  <option value="s3">{t("settings.data.backup.targetS3")}</option>
                </select>
              </div>
            </div>

            {draft.targetKind === "folder" && (
              <div className="mt-4 space-y-1.5">
                <Label htmlFor="backup-folder-path" className="text-xs">
                  {t("settings.data.backup.folderPathLabel")}
                </Label>
                <Input
                  id="backup-folder-path"
                  value={draft.folderPath}
                  onChange={(event) => patch({ folderPath: event.target.value })}
                  placeholder={t("settings.data.backup.folderPathPlaceholder")}
                  data-testid="backup-folder-path"
                />
              </div>
            )}

            {draft.targetKind === "webdav" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="backup-webdav-url" className="text-xs">
                    {t("settings.data.backup.webdavUrlLabel")}
                  </Label>
                  <Input
                    id="backup-webdav-url"
                    value={draft.webdavUrl}
                    onChange={(event) => patch({ webdavUrl: event.target.value })}
                    placeholder={t("settings.data.backup.webdavUrlPlaceholder")}
                    data-testid="backup-webdav-url"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="backup-webdav-username" className="text-xs">
                    {t("settings.data.backup.usernameLabel")}
                  </Label>
                  <Input
                    id="backup-webdav-username"
                    value={draft.webdavUsername}
                    onChange={(event) => patch({ webdavUsername: event.target.value })}
                    data-testid="backup-webdav-username"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="backup-webdav-password" className="text-xs">
                    {t("settings.data.backup.webdavPasswordLabel")}
                  </Label>
                  <Input
                    id="backup-webdav-password"
                    type="password"
                    value={draft.webdavPassword}
                    onChange={(event) => patch({ webdavPassword: event.target.value })}
                    placeholder={draft.hasTargetPassword ? keepStored : undefined}
                    autoComplete="new-password"
                    data-testid="backup-webdav-password"
                  />
                </div>
              </div>
            )}

            {draft.targetKind === "s3" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="backup-s3-endpoint" className="text-xs">
                    {t("settings.data.backup.s3EndpointLabel")}
                  </Label>
                  <Input
                    id="backup-s3-endpoint"
                    value={draft.s3Endpoint}
                    onChange={(event) => patch({ s3Endpoint: event.target.value })}
                    placeholder={t("settings.data.backup.s3EndpointPlaceholder")}
                    data-testid="backup-s3-endpoint"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="backup-s3-bucket" className="text-xs">
                    {t("settings.data.backup.s3BucketLabel")}
                  </Label>
                  <Input
                    id="backup-s3-bucket"
                    value={draft.s3Bucket}
                    onChange={(event) => patch({ s3Bucket: event.target.value })}
                    data-testid="backup-s3-bucket"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="backup-s3-region" className="text-xs">
                    {t("settings.data.backup.s3RegionLabel")}
                  </Label>
                  <Input
                    id="backup-s3-region"
                    value={draft.s3Region}
                    onChange={(event) => patch({ s3Region: event.target.value })}
                    data-testid="backup-s3-region"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="backup-s3-access-key-id" className="text-xs">
                    {t("settings.data.backup.s3AccessKeyIdLabel")}
                  </Label>
                  <Input
                    id="backup-s3-access-key-id"
                    value={draft.s3AccessKeyId}
                    onChange={(event) => patch({ s3AccessKeyId: event.target.value })}
                    data-testid="backup-s3-access-key-id"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="backup-s3-secret" className="text-xs">
                    {t("settings.data.backup.s3SecretAccessKeyLabel")}
                  </Label>
                  <Input
                    id="backup-s3-secret"
                    type="password"
                    value={draft.s3SecretAccessKey}
                    onChange={(event) => patch({ s3SecretAccessKey: event.target.value })}
                    placeholder={draft.hasTargetSecretAccessKey ? keepStored : undefined}
                    autoComplete="new-password"
                    data-testid="backup-s3-secret"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="backup-s3-prefix" className="text-xs">
                    {t("settings.data.backup.s3PrefixLabel")}
                  </Label>
                  <Input
                    id="backup-s3-prefix"
                    value={draft.s3Prefix}
                    onChange={(event) => patch({ s3Prefix: event.target.value })}
                    placeholder={t("settings.data.backup.s3PrefixPlaceholder")}
                    data-testid="backup-s3-prefix"
                  />
                </div>
              </div>
            )}

            <div className="mt-4 space-y-1.5">
              <Label htmlFor="backup-scheduled-passphrase" className="text-xs">
                {t("settings.data.backup.scheduledPassphraseLabel")}
              </Label>
              <Input
                id="backup-scheduled-passphrase"
                type="password"
                value={draft.passphrase}
                onChange={(event) => patch({ passphrase: event.target.value })}
                placeholder={draft.hasPassphrase ? keepStored : t("settings.data.backup.passphrasePlaceholder")}
                minLength={8}
                autoComplete="new-password"
                data-testid="backup-scheduled-passphrase"
              />
              <p className="text-[0.6875rem] text-muted-foreground leading-relaxed">
                {t("settings.data.backup.scheduledPassphraseHint")}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={update.isPending}
                data-testid="backup-save"
              >
                {update.isPending ? t("settings.data.backup.saving") : t("settings.data.backup.save")}
              </Button>
              {formError && (
                <p className="text-xs text-destructive" role="alert" data-testid="backup-save-error">
                  {formError}
                </p>
              )}
            </div>

            <div className="mt-4 space-y-1" data-testid="backup-status">
              {snapshot.lastRunAt ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.data.backup.lastRun", {
                      date: formatInstantInZone(snapshot.lastRunAt, locale),
                    })}
                  </p>
                  {snapshot.lastFileName && (
                    <p className="text-xs text-muted-foreground" data-testid="backup-last-file">
                      {t("settings.data.backup.lastFile", { file: snapshot.lastFileName })}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground" data-testid="backup-never-run">
                  {t("settings.data.backup.neverRun")}
                </p>
              )}
              {snapshot.lastError && (
                <p className="text-xs text-destructive" data-testid="backup-last-error">
                  {t("settings.data.backup.lastErrorTitle", {
                    message: t(lastErrorKey(snapshot.lastError)),
                  })}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
