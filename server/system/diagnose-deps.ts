/**
 * The real dependencies of the one-click diagnosis (C8.12).
 *
 * `server/system/diagnose.ts` is the logic and takes every answer through
 * an interface; this file is the one object that answers it for real, bound
 * to one user. It is loaded lazily by the router — the diagnosis is the
 * only thing that needs it — so the ordinary startup path does not pay for
 * importing the model registry, the scheduler and the channel adapters.
 *
 * Nothing here throws on purpose where a state will do:
 *
 *   - "no DATABASE_URL" is a state, not a failure;
 *   - a Redis that is not installed is fine for one process;
 *   - a local Ollama that is not running is fine — retrieval falls back to
 *     character bigrams;
 *   - a channel that was never configured is not an error.
 *
 * Only the things that are configured and then do not answer are thrown,
 * so the item becomes `fail` and the fix says what to check. The thrown
 * error text is never shown — the logic builds its own sentence.
 */
import { readdirSync, existsSync } from "node:fs";
import { readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENV } from "../_core/env";
import { hasFfmpeg } from "../_core/ffmpeg";
import { connectRedis, isRedisUsable } from "../_core/redis";
import { sttConfigured, sttEngine } from "../_core/stt";
import { ttsConfigured, ttsEngine } from "../_core/tts";
import * as db from "../db";
import { llmService, registry } from "../llm";
import { buildUserProvider } from "../llm/user-provider";
import { probeEmbedStatus, embedModelName } from "../chat/embeddings";
import { pythonIsAvailable } from "../skill-engine/runner";
import { getSchedulerStatus } from "../scheduler";
import { UPLOAD_FILE_CAP } from "./diagnose";
import type { DiagnoseDeps, DiagnoseProviderProbe } from "./diagnose";

/** Where the hand-written migrations live, relative to this source file. */
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
);

/** The newest `00NN_*.sql` in the migrations directory, or null. */
function latestMigrationVersion(): string | null {
  try {
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => /^\d+.*\.sql$/.test(name));
    if (files.length === 0) return null;
    files.sort((a, b) => {
      const numberA = Number.parseInt(a, 10);
      const numberB = Number.parseInt(b, 10);
      if (numberA !== numberB) return numberA - numberB;
      return a.localeCompare(b);
    });
    return files[files.length - 1]!.replace(/\.sql$/, "");
  } catch {
    return null;
  }
}

/** The chat model probes need a sentence to send; this is the shortest one. */
const PROBE_MESSAGE = "ping";

/** One provider, as the checks want it. */
function probeForProvider(
  name: string,
  provider: NonNullable<ReturnType<typeof registry.get>>,
  userId: number,
): DiagnoseProviderProbe {
  return {
    name,
    streaming: provider.capabilities.streaming,
    vision: provider.capabilities.vision,
    transcribe: typeof provider.transcribe === "function",
    async request(signal: AbortSignal): Promise<void> {
      await llmService.invokeWithProvider(provider, {
        messages: [{ role: "user", content: PROBE_MESSAGE }],
        /**
         * One token, purpose "other". The purpose is what makes the call
         * attributable if it is ever recorded; the token cap is what keeps
         * a diagnosis from costing anything worth noticing. Nothing else
         * is set — some models only accept their own temperature, and a
         * diagnosis must not call a working model broken because of a knob
         * it did not need.
         */
        options: { purpose: "other", maxTokens: 1, signal },
        /**
         * The probe is a real call to the user's model, so it is
         * recorded like one (C8.9): the cost panel has to see it.
         */
        usage: { userId },
      });
    },
  };
}

/**
 * The uploads directory, walked at most `UPLOAD_FILE_CAP` files deep.
 *
 * Symbolic links are not followed and not counted: a link is not an
 * upload, and following one can walk out of the data directory entirely.
 * A file that vanishes mid-walk simply does not contribute its size.
 */
export async function measureUploads(
  root: string,
  cap = UPLOAD_FILE_CAP,
): Promise<{ files: number; bytes: number; capped: boolean }> {
  let files = 0;
  let bytes = 0;
  const pending: string[] = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files >= cap) return { files, bytes, capped: true };
      if (entry.isDirectory()) {
        pending.push(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      try {
        bytes += (await stat(path.join(directory, entry.name))).size;
      } catch {
        // The file went away between the listing and the stat.
      }
    }
  }
  return { files, bytes, capped: false };
}

/**
 * Reads a channel's connection state.
 *
 * The manual says to read `channel_states`, and that is what happens first.
 * But WeChat's live connection is held in this process's memory and nothing
 * writes a `channel_states` row for it — so a connected WeChat bot would be
 * reported as "not configured". The in-process snapshot is more truthful
 * than the stored row, so it wins when it says something other than
 * "stopped".
 */
async function channelStatuses(
  userId: number,
): Promise<Array<{ channel: "wechat" | "feishu"; status: string | null }>> {
  const channels = ["wechat", "feishu"] as const;
  const out: Array<{ channel: "wechat" | "feishu"; status: string | null }> = [];
  for (const channel of channels) {
    let status: string | null = null;
    try {
      const row = await db.getChannelState(userId, channel);
      status = row?.status ?? null;
    } catch {
      // The database being down is the database item's news, not this one's.
      status = null;
    }
    if (channel === "wechat") {
      try {
        const { getBotStatus } = await import("../wechat/bot");
        const live = getBotStatus(userId).status;
        if (live !== "stopped") status = live;
      } catch {
        // The bot module could not be loaded; the stored row stays.
      }
    }
    out.push({ channel, status });
  }
  return out;
}

/** Whether the VAPID push keys are there, without generating them. */
async function vapidKeysPresent(): Promise<boolean> {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (publicKey && privateKey) return true;
  try {
    const { resolveDataRoot } = await import("../bootstrap/bootstrap");
    return existsSync(path.join(resolveDataRoot(), "vapid.json"));
  } catch {
    return false;
  }
}

/**
 * Everything the checks need, bound to one user.
 *
 * The reasons for the states are in the module comment above; this is where
 * each one is decided.
 */
export function createDiagnoseDeps(userId: number): DiagnoseDeps {
  return {
    now: () => new Date(),

    async pingDatabase() {
      if (!process.env.DATABASE_URL) return "no_database";
      try {
        const answers = await db.pingDatabase();
        return answers ? "ok" : "unreachable";
      } catch {
        return "unreachable";
      }
    },

    async readMigrationVersions() {
      const latest = latestMigrationVersion();
      if (!process.env.DATABASE_URL) {
        return { latest, applied: null, reachable: false };
      }
      try {
        const applied = await db.getLatestAppliedMigrationVersion();
        return { latest, applied, reachable: true };
      } catch {
        return { latest, applied: null, reachable: false };
      }
    },

    async databaseSizeBytes() {
      if (!process.env.DATABASE_URL) return null;
      const bytes = await db.getDatabaseSizeBytes();
      return bytes;
    },

    async redisStatus() {
      if ((process.env.MIRRAI_REDIS ?? "").trim().toLowerCase() === "off") {
        return "absent";
      }
      let handle: Awaited<ReturnType<typeof connectRedis>> = null;
      try {
        handle = await connectRedis();
      } catch {
        handle = null;
      }
      if (isRedisUsable(handle)) return "ok";
      if ((process.env.REDIS_URL ?? "").trim().length > 0) return "unreachable";
      return "absent";
    },

    /**
     * The user's own models, or — when they have none, so the app uses the
     * operator's — the operator's configured ones. Those are the models a
     * reply would actually go through.
     */
    async listProviders() {
      const configs = await db.getLlmConfigsByUserId(userId);
      const probes: DiagnoseProviderProbe[] = [];
      if (configs.length > 0) {
        for (const config of configs) {
          const provider = await buildUserProvider(userId, config);
          if (!provider) {
            probes.push({
              name: config.providerName,
              streaming: false,
              vision: false,
              transcribe: false,
              async request() {
                throw new Error("The provider is not available.");
              },
            });
            continue;
          }
          probes.push(probeForProvider(config.providerName || provider.name, provider, userId));
        }
        return probes;
      }
      for (const entry of registry.list()) {
        if (!entry.configured) continue;
        const provider = registry.get(entry.name);
        if (provider) probes.push(probeForProvider(provider.name, provider, userId));
      }
      return probes;
    },

    async probeOllamaEmbed() {
      const status = await probeEmbedStatus();
      return { status, model: embedModelName() };
    },

    sttStatus: () => ({ engine: sttEngine(), configured: sttConfigured() }),
    ttsStatus: () => ({ engine: ttsEngine(), configured: ttsConfigured() }),

    hasFfmpeg: () => hasFfmpeg(),

    vapidKeysPresent,

    async countPushSubscriptions() {
      const subscriptions = await db.listPushSubscriptions(userId);
      return subscriptions.length;
    },

    channelStatuses: () => channelStatuses(userId),

    pythonAvailable: () => pythonIsAvailable(),

    async countMissingSearchTokens() {
      const [records, messages] = await Promise.all([
        db.countMissingSearchTokens("records"),
        db.countMissingSearchTokens("messages"),
      ]);
      return { records, messages };
    },

    countPendingReplyJobs: () => db.countPendingReplyJobs(userId, new Date()),

    schedulerStatus: () => getSchedulerStatus(),

    measureUploads: () => measureUploads(path.resolve(ENV.uploadDir || "./uploads")),

    async diskSpace() {
      /**
       * The data root, not the uploads directory: it is where the database
       * backups, the models and the uploads all live, so it is the disk
       * that fills up.
       */
      const { resolveDataRoot } = await import("../bootstrap/bootstrap");
      const stats = await statfs(resolveDataRoot());
      return {
        freeBytes: Number(stats.bavail) * Number(stats.bsize),
        totalBytes: Number(stats.blocks) * Number(stats.bsize),
      };
    },
  };
}
