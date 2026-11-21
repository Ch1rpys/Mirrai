/**
 * The shape of a scheduled backup's destination (C8.3).
 *
 * The backup file itself is written by `server/_core/backup.ts`; this
 * module is the part both the server and the interface read: what a
 * target is, what "daily" means, and how the stored JSON is cleaned up
 * before anything trusts it.
 *
 * Two rules are the reason this is a normalizer and not a cast:
 *
 *  - Nothing is enabled without a destination. A settings object that
 *    says "on" but has no target would make the scheduler run every
 *    night and write nowhere.
 *  - A remote destination always carries an encrypted passphrase. A
 *    backup sitting in somebody else's bucket is not private unless it
 *    is encrypted, and an unattended run has no one to ask for the
 *    passphrase.
 */

/** The number of scheduled backups kept on the target. */
export const BACKUP_RETENTION = 7;

/** How a scheduled backup leaves this machine (C8.3). */
export type BackupTargetKind = "folder" | "webdav" | "s3";

export type BackupFrequency = "daily" | "weekly";

export interface BackupFolderTarget {
  kind: "folder";
  /** An absolute path: the app must not guess where "a folder" is. */
  path: string;
}

export interface BackupWebDavTarget {
  kind: "webdav";
  /** `https://dav.example.com/remote.php/dav/files/me/mirrai` */
  url: string;
  username: string;
  /** Basic-auth password, wrapped by `encryptSecret` before it is stored. */
  passwordSecret?: string;
}

export interface BackupS3Target {
  kind: "s3";
  /** The S3-compatible endpoint, e.g. `https://s3.us-east-1.amazonaws.com`. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  /** Wrapped by `encryptSecret` before it is stored. */
  secretAccessKeySecret?: string;
  /** Key prefix inside the bucket; `mirrai` when missing. */
  prefix?: string;
}

export type BackupTarget = BackupFolderTarget | BackupWebDavTarget | BackupS3Target;

export interface BackupSettings {
  /** False (and absent in the stored JSON) when the user never turned it on. */
  enabled: boolean;
  frequency: BackupFrequency;
  target?: BackupTarget;
  /**
   * The passphrase the backup files are encrypted with, wrapped by
   * `encryptSecret`. Remote targets require it; a local folder may
   * leave it out, and then the files are plain `.zip`.
   */
  passphraseSecret?: string;
  /** When the last scheduled run finished, ISO. */
  lastRunAt?: string;
  /** The file name of the last backup that reached the target. */
  lastFileName?: string;
  /**
   * The scheduled backups already written, newest last.
   *
   * Only the newest `BACKUP_RETENTION` are kept and this list is how the
   * older ones are found again for deletion — listing a WebDAV or S3
   * destination is another authenticated request with another format,
   * and the names of our own files are already known.
   */
  history?: string[];
  /** The last failure's sentence, for the settings page to show. */
  lastError?: string;
}

export const BACKUP_TARGET_KINDS: readonly BackupTargetKind[] = ["folder", "webdav", "s3"];

export const BACKUP_FREQUENCIES: readonly BackupFrequency[] = ["daily", "weekly"];

/** The gap between two scheduled backups. */
export function backupIntervalMs(frequency: BackupFrequency): number {
  return (frequency === "weekly" ? 7 : 1) * 24 * 60 * 60 * 1000;
}

export function isRemoteBackupTarget(target: BackupTarget | undefined): boolean {
  return target?.kind === "webdav" || target?.kind === "s3";
}

/** The extension a backup file gets: encrypted or plain. */
export function backupExtension(encrypted: boolean): string {
  return encrypted ? ".mirrai-backup" : ".zip";
}

/**
 * A file name for a backup.
 *
 * The timestamp is UTC and sorts as text, so the newest is the last
 * name in a sorted list and the prefix is the same everywhere.
 */
export function backupFileName(now: Date, encrypted: boolean): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `mirrai-backup-${stamp}${backupExtension(encrypted)}`;
}

/**
 * Whether a scheduled run is due.
 *
 * A settings object that has never run is due as soon as it is enabled:
 * the user turned it on just now, and waiting a day to make the first
 * copy is not what they asked for.
 */
export function isBackupDue(settings: BackupSettings, now: Date): boolean {
  if (!settings.enabled || !settings.target) return false;
  if (!settings.lastRunAt) return true;
  const last = Date.parse(settings.lastRunAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() >= last + backupIntervalMs(settings.frequency);
}

function asString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** An absolute path, so "the folder" cannot mean two different places. */
export function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function asHttpUrl(value: unknown): string | undefined {
  const text = asString(value, 2048);
  if (!text) return undefined;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function normalizeTarget(value: unknown): BackupTarget | undefined {
  const source = asObject(value);
  if (!source) return undefined;

  if (source.kind === "folder") {
    const path = asString(source.path, 4096);
    if (!path || !isAbsolutePath(path)) return undefined;
    return { kind: "folder", path };
  }

  if (source.kind === "webdav") {
    const url = asHttpUrl(source.url);
    const username = asString(source.username, 200);
    if (!url || !username) return undefined;
    const target: BackupWebDavTarget = { kind: "webdav", url, username };
    const passwordSecret = asString(source.passwordSecret, 4096);
    if (passwordSecret) target.passwordSecret = passwordSecret;
    return target;
  }

  if (source.kind === "s3") {
    const endpoint = asHttpUrl(source.endpoint);
    const bucket = asString(source.bucket, 255);
    const region = asString(source.region, 64);
    const accessKeyId = asString(source.accessKeyId, 256);
    if (!endpoint || !bucket || !region || !accessKeyId) return undefined;
    const target: BackupS3Target = { kind: "s3", endpoint, bucket, region, accessKeyId };
    const secretAccessKeySecret = asString(source.secretAccessKeySecret, 4096);
    if (secretAccessKeySecret) target.secretAccessKeySecret = secretAccessKeySecret;
    const prefix = asString(source.prefix, 512);
    if (prefix) target.prefix = prefix.replace(/^\/+/, "").replace(/\/+$/, "") || undefined;
    return target;
  }

  return undefined;
}

function normalizeHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    const name = asString(item, 255);
    // Our own files only: a name that could walk out of the target
    // folder is not something this app wrote.
    if (!name) continue;
    if (name.includes("/") || name.includes("\\") || name.startsWith(".")) continue;
    names.push(name);
  }
  return names.slice(-BACKUP_RETENTION);
}

/**
 * Cleans up whatever is in `users.backupSettings`.
 *
 * Unknown keys are dropped, a target that is not one of the three is
 * dropped with it, and `enabled` is only true when there is a target to
 * be enabled for. A remote target without the wrapped passphrase is not
 * accepted: the file would have to be written in the clear.
 */
export function normalizeBackupSettings(value: unknown): BackupSettings {
  const source = asObject(value) ?? {};
  const settings: BackupSettings = {
    enabled: false,
    frequency: source.frequency === "weekly" ? "weekly" : "daily",
  };

  const target = normalizeTarget(source.target);
  const passphraseSecret = asString(source.passphraseSecret, 4096);
  if (target) settings.target = target;
  if (passphraseSecret) settings.passphraseSecret = passphraseSecret;

  if (
    target &&
    (!isRemoteBackupTarget(target) || Boolean(passphraseSecret)) &&
    source.enabled === true
  ) {
    settings.enabled = true;
  }

  const lastRunAt = asString(source.lastRunAt, 64);
  if (lastRunAt && Number.isFinite(Date.parse(lastRunAt))) settings.lastRunAt = lastRunAt;
  const lastFileName = asString(source.lastFileName, 255);
  if (lastFileName) {
    settings.lastFileName = lastFileName;
  }
  const history = normalizeHistory(source.history);
  if (history.length) settings.history = history;
  const lastError = asString(source.lastError, 500);
  if (lastError) settings.lastError = lastError;
  return settings;
}

/** The settings a brand-new user has: off, with no destination. */
export function defaultBackupSettings(): BackupSettings {
  return { enabled: false, frequency: "daily" };
}

/**
 * A target as the interface sees it: the destination, never the secret.
 *
 * The wrapped password and access key stay on the server. The page shows
 * "set" or "not set" and lets the user replace them.
 */
export type PublicBackupTarget =
  | { kind: "folder"; path: string }
  | { kind: "webdav"; url: string; username: string }
  | { kind: "s3"; endpoint: string; bucket: string; region: string; accessKeyId: string; prefix?: string };

/** The settings as the settings page sees them. */
export interface PublicBackupSettings {
  enabled: boolean;
  frequency: BackupFrequency;
  target?: PublicBackupTarget;
  hasPassphrase: boolean;
  hasTargetPassword: boolean;
  hasTargetSecretAccessKey: boolean;
  lastRunAt?: string;
  lastFileName?: string;
  lastError?: string;
}

/**
 * Strips the wrapped secrets off a settings object.
 *
 * The download of a complete backup needs the passphrase, and the
 * scheduled backup needs the stored one — neither is ever sent to the
 * browser.
 */
export function toPublicBackupSettings(settings: BackupSettings): PublicBackupSettings {
  const out: PublicBackupSettings = {
    enabled: settings.enabled,
    frequency: settings.frequency,
    hasPassphrase: Boolean(settings.passphraseSecret),
    hasTargetPassword: Boolean(
      settings.target?.kind === "webdav" && settings.target.passwordSecret,
    ),
    hasTargetSecretAccessKey: Boolean(
      settings.target?.kind === "s3" && settings.target.secretAccessKeySecret,
    ),
  };
  if (settings.target) {
    const target = settings.target;
    if (target.kind === "folder") out.target = { kind: "folder", path: target.path };
    else if (target.kind === "webdav") {
      out.target = { kind: "webdav", url: target.url, username: target.username };
    } else {
      out.target = {
        kind: "s3",
        endpoint: target.endpoint,
        bucket: target.bucket,
        region: target.region,
        accessKeyId: target.accessKeyId,
        ...(target.prefix ? { prefix: target.prefix } : {}),
      };
    }
  }
  if (settings.lastRunAt) out.lastRunAt = settings.lastRunAt;
  if (settings.lastFileName) out.lastFileName = settings.lastFileName;
  if (settings.lastError) out.lastError = settings.lastError;
  return out;
}
