/**
 * Scheduled backups and the full download (C8.3).
 *
 * The routes here only handle the settings and what the settings page
 * needs to say; the bytes of a download and the body of a restore are
 * plain Express routes (`server/backup/route.ts`) because they are
 * streams, and tRPC has no streaming support.
 *
 * Secrets never travel back to the browser: the page learns whether a
 * passphrase, a WebDAV password or an S3 secret is set, and can replace
 * it. A target is never saved "on" without a destination.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  isAbsolutePath,
  isRemoteBackupTarget,
  normalizeBackupSettings,
  toPublicBackupSettings,
  type BackupSettings,
  type BackupTarget,
} from "@shared/backup";
import { copy } from "@shared/copy";
import { protectedProcedure, router } from "../_core/trpc";
import { encryptSecret } from "../_core/crypto";
import { getUserBackupSettings, setUserBackupSettings } from "../db";

const TARGET = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folder"), path: z.string().trim().min(1).max(4096) }),
  z.object({
    kind: z.literal("webdav"),
    url: z.string().trim().url().max(2048),
    username: z.string().trim().min(1).max(200),
  }),
  z.object({
    kind: z.literal("s3"),
    endpoint: z.string().trim().url().max(2048),
    bucket: z.string().trim().min(1).max(255),
    region: z.string().trim().min(1).max(64),
    accessKeyId: z.string().trim().min(1).max(256),
    prefix: z.string().trim().max(512).optional(),
  }),
]);

const UPDATE_INPUT = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly"]),
  target: TARGET.optional(),
  /** A new passphrase; absent means keep the stored one. */
  passphrase: z.string().min(8).max(1024).optional(),
  clearPassphrase: z.boolean().optional(),
  /** The WebDAV password, or the S3 secret key, when replaced. */
  targetPassword: z.string().max(4096).optional(),
  clearTargetPassword: z.boolean().optional(),
  targetSecretAccessKey: z.string().max(4096).optional(),
  clearTargetSecretAccessKey: z.boolean().optional(),
});

function fail(locale: Parameters<typeof copy>[0], key: Parameters<typeof copy>[1]): never {
  throw new TRPCError({ code: "BAD_REQUEST", message: copy(locale, key) });
}

export const backupRouter = router({
  /** The settings page's view: destinations and what is set, no secrets. */
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const stored = await getUserBackupSettings(ctx.user.id);
    const settings = normalizeBackupSettings(stored);
    return toPublicBackupSettings(settings);
  }),

  /**
   * Saves the settings.
   *
   * The stored secrets are kept unless the caller explicitly replaces or
   * clears them; the page shows "set" and does not have to send them
   * back to save an unrelated field.
   */
  updateSettings: protectedProcedure
    .input(UPDATE_INPUT)
    .mutation(async ({ ctx, input }) => {
      const stored = await getUserBackupSettings(ctx.user.id);
      const current = normalizeBackupSettings(stored);

      const next: BackupSettings = { ...current };
      next.enabled = input.enabled;
      next.frequency = input.frequency;

      let target: BackupTarget | undefined;
      if (input.target) {
        if (input.target.kind === "folder" && !isAbsolutePath(input.target.path)) {
          fail(ctx.locale, "backup.errorFolderPath");
        }
        target = input.target as BackupTarget;
        // A destination keeps its stored secret when it is still the same
        // destination: changing the folder or the frequency must not
        // require retyping the WebDAV password.
        const previous = current.target;
        if (previous && previous.kind === target.kind) {
          if (previous.kind === "webdav" && target.kind === "webdav" && previous.passwordSecret) {
            target.passwordSecret = previous.passwordSecret;
          }
          if (previous.kind === "s3" && target.kind === "s3" && previous.secretAccessKeySecret) {
            target.secretAccessKeySecret = previous.secretAccessKeySecret;
          }
        }
        next.target = target;
      } else {
        delete next.target;
      }

      // The passphrase.
      if (input.clearPassphrase) delete next.passphraseSecret;
      if (input.passphrase) next.passphraseSecret = await encryptSecret(input.passphrase);

      if (target?.kind === "webdav") {
        if (input.clearTargetPassword) delete target.passwordSecret;
        if (input.targetPassword) target.passwordSecret = await encryptSecret(input.targetPassword);
      }
      if (target?.kind === "s3") {
        if (input.clearTargetSecretAccessKey) delete target.secretAccessKeySecret;
        if (input.targetSecretAccessKey) {
          target.secretAccessKeySecret = await encryptSecret(input.targetSecretAccessKey);
        }
        if (input.target?.kind === "s3" && input.target.prefix !== undefined) {
          overSetPrefix(target, input.target.prefix);
        }
      }

      if (next.enabled && !next.target) fail(ctx.locale, "backup.errorTargetRequired");
      if (next.target && isRemoteBackupTarget(next.target) && !next.passphraseSecret) {
        fail(ctx.locale, "backup.errorRemotePassphrase");
      }

      await setUserBackupSettings(ctx.user.id, next);
      const saved = normalizeBackupSettings(await getUserBackupSettings(ctx.user.id));
      return toPublicBackupSettings(saved);
    }),
});

/** Keeps the normalized prefix tidy when the page sends a new one. */
function overSetPrefix(target: { prefix?: string }, prefix: string | undefined): void {
  const cleaned = (prefix ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (cleaned) target.prefix = cleaned;
  else delete target.prefix;
}
