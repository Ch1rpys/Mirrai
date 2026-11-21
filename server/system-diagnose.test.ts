/**
 * The one-click diagnosis (C8.12).
 *
 * Every dependency is mocked: no model, no network, no database, no clock.
 * The checks are pure functions of the answers they are given, so each of
 * their states can be produced on purpose — which is the whole point of the
 * `DiagnoseDeps` interface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@shared/copy";
import {
  formatDiagnoseReport,
  sortDiagnoseItems,
  type DiagnoseItem,
} from "@shared/system-diagnose";
import {
  DIAGNOSE_CHECK_TIMEOUT_MS,
  LOW_DISK_BYTES,
  runDiagnose,
  UPLOAD_FILE_CAP,
  type DiagnoseDeps,
  type DiagnoseResult,
} from "./system/diagnose";

/** A fixed clock: the scheduler check reads the distance from "now". */
const NOW = new Date("2026-03-01T00:00:00.000Z");

/** A healthy machine, for the tests that only care about one check. */
function makeDeps(overrides: Partial<DiagnoseDeps> = {}): DiagnoseDeps {
  return {
    now: () => NOW,
    pingDatabase: async () => "ok",
    readMigrationVersions: async () => ({
      latest: "0078_soft_delete",
      applied: "0078_soft_delete",
      reachable: true,
    }),
    databaseSizeBytes: async () => 40 * 1024 * 1024,
    redisStatus: async () => "absent",
    listProviders: async () => [],
    probeOllamaEmbed: async () => ({ status: "ready", model: "bge-m3" }),
    sttStatus: () => ({ engine: "provider", configured: true }),
    ttsStatus: () => ({ engine: "edge", configured: true }),
    hasFfmpeg: async () => true,
    vapidKeysPresent: async () => true,
    countPushSubscriptions: async () => 2,
    channelStatuses: async () => [
      { channel: "wechat", status: "logged_in" },
      { channel: "feishu", status: "stopped" },
    ],
    pythonAvailable: async () => true,
    countMissingSearchTokens: async () => ({ records: 0, messages: 0 }),
    countPendingReplyJobs: async () => ({ pending: 0, overdue: 0 }),
    schedulerStatus: () => ({ lastTickAt: new Date(NOW.getTime() - 30_000) }),
    measureUploads: async () => ({ files: 12, bytes: 4096, capped: false }),
    diskSpace: async () => ({
      freeBytes: 100 * 1024 ** 3,
      totalBytes: 500 * 1024 ** 3,
    }),
    ...overrides,
  };
}

async function run(
  overrides: Partial<DiagnoseDeps> = {},
  timeoutMs?: number,
): Promise<DiagnoseResult> {
  return runDiagnose({ locale: "zh", deps: makeDeps(overrides), timeoutMs });
}

function item(result: DiagnoseResult, id: string): DiagnoseItem {
  const found = result.items.find((entry) => entry.id === id);
  if (!found) throw new Error(`no item with id ${id}`);
  return found;
}

const labels = {
  title: "report",
  status: { ok: "ok", warn: "warn", fail: "fail", skipped: "skipped" },
  fixPrefix: "fix: ",
};

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The checks log a line for a dependency that throws; the tests throw on
  // purpose and do not need the noise.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("the diagnosis result", () => {
  it("reports every check, once each", async () => {
    const result = await run();
    const ids = result.items.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      "database",
      "migrations",
      "redis",
      "providers",
      "ollama",
      "stt",
      "tts",
      "ffmpeg",
      "push.vapid",
      "push.subscriptions",
      "channel.wechat",
      "channel.feishu",
      "python",
      "backfill",
      "replyJobs",
      "scheduler",
      "storage.uploads",
      "storage.database",
      "storage.disk",
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it("puts the problems first and the unchecked ones last", async () => {
    const result = await run({
      pingDatabase: async () => {
        throw new Error("no");
      },
      countPushSubscriptions: async () => 0,
    });
    const rank: Record<DiagnoseItem["status"], number> = {
      fail: 0,
      warn: 1,
      ok: 2,
      skipped: 3,
    };
    const ranks = result.items.map((entry) => rank[entry.status]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(result.items[0]!.status).toBe("fail");
    expect(result.items.at(-1)!.status).toBe("skipped");
  });

  it("gives every check ten seconds, and the uploads walk 50,000 files", () => {
    expect(DIAGNOSE_CHECK_TIMEOUT_MS).toBe(10_000);
    expect(UPLOAD_FILE_CAP).toBe(50_000);
  });
});

describe("the database check", () => {
  it("is ok when the database answers", async () => {
    const found = item(await run(), "database");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(copy("zh", "diagnostics.database.ok"));
  });

  it("is skipped when no database is configured", async () => {
    const found = item(await run({ pingDatabase: async () => "no_database" }), "database");
    expect(found.status).toBe("skipped");
    expect(found.detail).toBe(copy("zh", "diagnostics.database.skipped"));
    expect(found.fix).toBe(copy("zh", "diagnostics.database.skippedFix"));
  });

  it("fails when the database is configured but does not answer", async () => {
    const found = item(await run({ pingDatabase: async () => "unreachable" }), "database");
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(copy("zh", "diagnostics.database.fail"));
    expect(found.fix).toBe(copy("zh", "diagnostics.database.failFix"));
    // The driver's own message is not quoted; it can carry a URL and a key.
    expect(found.detail).not.toContain("ECONNREFUSED");
  });
});

describe("the migrations check", () => {
  it("is ok when the database is on the newest migration", async () => {
    const found = item(await run(), "migrations");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.migrations.ok", { version: "0078_soft_delete" }),
    );
  });

  it("fails when a migration has not been applied", async () => {
    const found = item(
      await run({
        readMigrationVersions: async () => ({
          latest: "0078_soft_delete",
          applied: "0076_user_budget",
          reachable: true,
        }),
      }),
      "migrations",
    );
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.migrations.fail", {
        applied: "0076_user_budget",
        latest: "0078_soft_delete",
      }),
    );
    expect(found.fix).toBe(copy("zh", "diagnostics.migrations.failFix"));
  });

  it("warns when the database is newer than the code", async () => {
    const found = item(
      await run({
        readMigrationVersions: async () => ({
          latest: "0077_message_marks",
          applied: "0078_soft_delete",
          reachable: true,
        }),
      }),
      "migrations",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.migrations.warn", {
        applied: "0078_soft_delete",
        latest: "0077_message_marks",
      }),
    );
  });

  it("fails when nothing has been applied", async () => {
    const found = item(
      await run({
        readMigrationVersions: async () => ({
          latest: "0078_soft_delete",
          applied: null,
          reachable: true,
        }),
      }),
      "migrations",
    );
    expect(found.status).toBe("fail");
    expect(found.fix).toBe(copy("zh", "diagnostics.migrations.failFix"));
  });

  it("is skipped when the database could not be read", async () => {
    const found = item(
      await run({
        readMigrationVersions: async () => ({
          latest: "0078_soft_delete",
          applied: null,
          reachable: false,
        }),
      }),
      "migrations",
    );
    expect(found.status).toBe("skipped");
    expect(found.detail).toBe(copy("zh", "diagnostics.migrations.skipped"));
  });
});

describe("the redis check", () => {
  it("is ok when the store answers", async () => {
    const found = item(await run({ redisStatus: async () => "ok" }), "redis");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(copy("zh", "diagnostics.redis.ok"));
  });

  it("is skipped when there is no Redis — one process does not need one", async () => {
    const found = item(await run({ redisStatus: async () => "absent" }), "redis");
    expect(found.status).toBe("skipped");
    expect(found.fix).toBe(copy("zh", "diagnostics.redis.skippedFix"));
  });

  it("fails when REDIS_URL is set but the store does not answer", async () => {
    const found = item(await run({ redisStatus: async () => "unreachable" }), "redis");
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(copy("zh", "diagnostics.redis.fail"));
    expect(found.detail).not.toContain("redis://secret");
  });
});

describe("the provider checks", () => {
  function provider(overrides: Record<string, unknown> = {}) {
    return {
      name: "OpenAI",
      streaming: true,
      vision: true,
      transcribe: true,
      request: async () => {},
      ...overrides,
    };
  }

  it("is skipped when no model is configured", async () => {
    const found = item(await run(), "providers");
    expect(found.status).toBe("skipped");
    expect(found.detail).toBe(copy("zh", "diagnostics.providers.skipped"));
    expect(found.fix).toBe(copy("zh", "diagnostics.providers.skippedFix"));
  });

  it("is ok when the tiny request succeeds, and says what the model can do", async () => {
    const result = await run({ listProviders: async () => [provider()] });
    const found = item(result, "provider.openai");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.provider.ok", {
        provider: "OpenAI",
        streaming: copy("zh", "diagnostics.provider.canStream"),
        vision: copy("zh", "diagnostics.provider.canSee"),
        transcription: copy("zh", "diagnostics.provider.canTranscribe"),
      }),
    );
    expect(found.detail).toContain("能看图");
    expect(found.detail).toContain("能转写");
  });

  it("warns when the request works but replies cannot stream", async () => {
    const result = await run({
      listProviders: async () => [provider({ streaming: false, vision: false, transcribe: false })],
    });
    const found = item(result, "provider.openai");
    expect(found.status).toBe("warn");
    expect(found.detail).toContain("不能边生成边显示");
    expect(found.detail).toContain("不能看图");
    expect(found.fix).toBe(copy("zh", "diagnostics.provider.warnFix"));
  });

  it("fails when the provider does not answer, without quoting the error", async () => {
    const result = await run({
      listProviders: async () => [
        provider({
          request: async () => {
            throw new Error("401 invalid api key sk-sentinel");
          },
        }),
      ],
    });
    const found = item(result, "provider.openai");
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.provider.fail", { provider: "OpenAI" }),
    );
    expect(found.fix).toBe(copy("zh", "diagnostics.provider.failFix"));
    expect(found.detail).not.toContain("sk-sentinel");
  });

  it("turns a provider that never answers into a timeout failure", async () => {
    const result = await run(
      {
        listProviders: async () => [
          provider({
            request: () => new Promise<void>(() => {}),
          }),
        ],
      },
      20,
    );
    const found = item(result, "provider.openai");
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(copy("zh", "diagnostics.timeout", { seconds: 1 }));
  });

  it("keeps two rows for the same provider apart", async () => {
    const result = await run({
      listProviders: async () => [provider(), provider({ streaming: false })],
    });
    expect(item(result, "provider.openai").status).toBe("ok");
    expect(item(result, "provider.openai.2").status).toBe("warn");
  });
});

describe("the Ollama check", () => {
  it("is ok when the daemon and the embedding model are there", async () => {
    const found = item(await run(), "ollama");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.ollama.ok", { model: "bge-m3" }),
    );
  });

  it("warns when the daemon is there but the model is not", async () => {
    const found = item(
      await run({ probeOllamaEmbed: async () => ({ status: "no_model", model: "bge-m3" }) }),
      "ollama",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.ollama.noModel", { model: "bge-m3" }),
    );
    expect(found.fix).toBe(copy("zh", "diagnostics.ollama.noModelFix", { model: "bge-m3" }));
  });

  it("warns when the daemon is not running — retrieval just falls back", async () => {
    const found = item(
      await run({
        probeOllamaEmbed: async () => ({ status: "no_ollama", model: "bge-m3" }),
      }),
      "ollama",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(copy("zh", "diagnostics.ollama.unreachable"));
  });

  it("fails when the probe itself throws", async () => {
    const found = item(
      await run({
        probeOllamaEmbed: async () => {
          throw new Error("probe exploded");
        },
      }),
      "ollama",
    );
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(copy("zh", "diagnostics.error"));
  });
});

describe("the transcription check", () => {
  it("is ok when the engine is configured", async () => {
    const found = item(await run(), "stt");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(copy("zh", "diagnostics.stt.ok", { engine: "provider" }));
  });

  it("warns when the engine is missing what it needs", async () => {
    const found = item(
      await run({ sttStatus: () => ({ engine: "whisper-cpp", configured: false }) }),
      "stt",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.stt.warn", { engine: "whisper-cpp" }),
    );
  });

  it("is skipped when transcription is switched off", async () => {
    const found = item(await run({ sttStatus: () => ({ engine: "off", configured: false }) }), "stt");
    expect(found.status).toBe("skipped");
    expect(found.detail).toBe(copy("zh", "diagnostics.stt.skipped"));
  });

  it("fails when reading the engine throws", async () => {
    const found = item(
      await run({
        sttStatus: () => {
          throw new Error("bad env");
        },
      }),
      "stt",
    );
    expect(found.status).toBe("fail");
  });
});

describe("the read-aloud check", () => {
  it("is ok when the engine is configured", async () => {
    const found = item(await run(), "tts");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(copy("zh", "diagnostics.tts.ok", { engine: "edge" }));
  });

  it("warns when the engine is missing what it needs", async () => {
    const found = item(
      await run({ ttsStatus: () => ({ engine: "piper", configured: false }) }),
      "tts",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(copy("zh", "diagnostics.tts.warn", { engine: "piper" }));
  });

  it("is skipped when read-aloud is switched off", async () => {
    const found = item(await run({ ttsStatus: () => ({ engine: "off", configured: false }) }), "tts");
    expect(found.status).toBe("skipped");
    expect(found.detail).toBe(copy("zh", "diagnostics.tts.skipped"));
  });

  it("fails when reading the engine throws", async () => {
    const found = item(
      await run({
        ttsStatus: () => {
          throw new Error("bad env");
        },
      }),
      "tts",
    );
    expect(found.status).toBe("fail");
  });
});

describe("the ffmpeg check", () => {
  it("is ok when ffmpeg is installed", async () => {
    const found = item(await run(), "ffmpeg");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(copy("zh", "diagnostics.ffmpeg.ok"));
  });

  it("warns when it is not — the optional tool is not a failure", async () => {
    const found = item(await run({ hasFfmpeg: async () => false }), "ffmpeg");
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(copy("zh", "diagnostics.ffmpeg.warn"));
    expect(found.fix).toBe(copy("zh", "diagnostics.ffmpeg.warnFix"));
  });

  it("fails when the probe throws", async () => {
    const found = item(
      await run({
        hasFfmpeg: async () => {
          throw new Error("spawn failed");
        },
      }),
      "ffmpeg",
    );
    expect(found.status).toBe("fail");
  });
});

describe("the push checks", () => {
  it("says the keys are there", async () => {
    const found = item(await run(), "push.vapid");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(copy("zh", "diagnostics.push.vapidOk"));
  });

  it("warns when the keys have not been generated yet", async () => {
    const found = item(await run({ vapidKeysPresent: async () => false }), "push.vapid");
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(copy("zh", "diagnostics.push.vapidWarn"));
  });

  it("fails when checking the keys throws", async () => {
    const found = item(
      await run({
        vapidKeysPresent: async () => {
          throw new Error("fs");
        },
      }),
      "push.vapid",
    );
    expect(found.status).toBe("fail");
  });

  it("counts the browser subscriptions", async () => {
    const found = item(await run(), "push.subscriptions");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.push.subscriptionsOk", { count: 2 }),
    );
  });

  it("warns when there are no subscriptions", async () => {
    const found = item(await run({ countPushSubscriptions: async () => 0 }), "push.subscriptions");
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(copy("zh", "diagnostics.push.subscriptionsWarn"));
    expect(found.fix).toBe(copy("zh", "diagnostics.push.subscriptionsWarnFix"));
  });

  it("fails when counting them throws", async () => {
    const found = item(
      await run({
        countPushSubscriptions: async () => {
          throw new Error("db");
        },
      }),
      "push.subscriptions",
    );
    expect(found.status).toBe("fail");
  });
});

describe("the channel checks", () => {
  it("is ok when the channel is connected", async () => {
    const found = item(await run(), "channel.wechat");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.channel.ok", { channel: "微信" }),
    );
  });

  it("is skipped when the channel is not in use", async () => {
    const found = item(await run(), "channel.feishu");
    expect(found.status).toBe("skipped");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.channel.off", { channel: "飞书" }),
    );
  });

  it("warns when the channel is configured but not connected", async () => {
    const found = item(
      await run({
        channelStatuses: async () => [
          { channel: "wechat", status: "connected" },
          { channel: "feishu", status: "configured" },
        ],
      }),
      "channel.feishu",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.channel.warn", { channel: "飞书" }),
    );
  });

  it("fails when the channel reports an error", async () => {
    const found = item(
      await run({
        channelStatuses: async () => [
          { channel: "wechat", status: "error" },
          { channel: "feishu", status: "stopped" },
        ],
      }),
      "channel.wechat",
    );
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.channel.fail", { channel: "微信" }),
    );
  });

  it("is skipped when a channel was never configured", async () => {
    const found = item(
      await run({
        channelStatuses: async () => [
          { channel: "wechat", status: null },
          { channel: "feishu", status: null },
        ],
      }),
      "channel.wechat",
    );
    expect(found.status).toBe("skipped");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.channel.skipped", { channel: "微信" }),
    );
  });

  it("turns the whole read into one failure item when it throws", async () => {
    const result = await run({
      channelStatuses: async () => {
        throw new Error("db down");
      },
    });
    expect(item(result, "channels").status).toBe("fail");
    expect(result.items.some((entry) => entry.id === "channel.wechat")).toBe(false);
  });
});

describe("the collector Python check", () => {
  it("is ok when the interpreter is there", async () => {
    const found = item(await run(), "python");
    expect(found.status).toBe("ok");
  });

  it("warns when it is not — collectors are optional", async () => {
    const found = item(await run({ pythonAvailable: async () => false }), "python");
    expect(found.status).toBe("warn");
    expect(found.fix).toBe(copy("zh", "diagnostics.python.warnFix"));
  });

  it("fails when the probe throws", async () => {
    const found = item(
      await run({
        pythonAvailable: async () => {
          throw new Error("spawn");
        },
      }),
      "python",
    );
    expect(found.status).toBe("fail");
  });
});

describe("the backfill check", () => {
  it("is ok when nothing is missing an index", async () => {
    const found = item(await run(), "backfill");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(copy("zh", "diagnostics.backfill.ok"));
  });

  it("warns while the backfill still has rows to do", async () => {
    const found = item(
      await run({
        countMissingSearchTokens: async () => ({ records: 12, messages: 34 }),
      }),
      "backfill",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.backfill.warn", { records: 12, messages: 34 }),
    );
    expect(found.fix).toBe(copy("zh", "diagnostics.backfill.warnFix"));
  });

  it("fails when counting throws", async () => {
    const found = item(
      await run({
        countMissingSearchTokens: async () => {
          throw new Error("db");
        },
      }),
      "backfill",
    );
    expect(found.status).toBe("fail");
  });
});

describe("the reply-job check", () => {
  it("is ok when the queue is empty", async () => {
    const found = item(await run(), "replyJobs");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(copy("zh", "diagnostics.replyJobs.ok"));
  });

  it("is ok when the waiting jobs are not due yet", async () => {
    const found = item(
      await run({ countPendingReplyJobs: async () => ({ pending: 3, overdue: 0 }) }),
      "replyJobs",
    );
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.replyJobs.pendingOk", { pending: 3 }),
    );
  });

  it("warns when a job is past its due time", async () => {
    const found = item(
      await run({ countPendingReplyJobs: async () => ({ pending: 3, overdue: 1 }) }),
      "replyJobs",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.replyJobs.warn", { pending: 3, overdue: 1 }),
    );
    expect(found.fix).toBe(copy("zh", "diagnostics.replyJobs.warnFix"));
  });

  it("fails when counting throws", async () => {
    const found = item(
      await run({
        countPendingReplyJobs: async () => {
          throw new Error("db");
        },
      }),
      "replyJobs",
    );
    expect(found.status).toBe("fail");
  });
});

describe("the scheduler check", () => {
  it("is ok when the last tick was a moment ago", async () => {
    const found = item(await run(), "scheduler");
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(copy("zh", "diagnostics.scheduler.justNow"));
  });

  it("says how many minutes ago the last tick was", async () => {
    const found = item(
      await run({
        schedulerStatus: () => ({ lastTickAt: new Date(NOW.getTime() - 3 * 60_000) }),
      }),
      "scheduler",
    );
    expect(found.status).toBe("ok");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.scheduler.ok", { minutes: 3 }),
    );
  });

  it("warns when the scheduler has stopped ticking", async () => {
    const found = item(
      await run({
        schedulerStatus: () => ({ lastTickAt: new Date(NOW.getTime() - 30 * 60_000) }),
      }),
      "scheduler",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.scheduler.warn", { minutes: 30 }),
    );
    expect(found.fix).toBe(copy("zh", "diagnostics.scheduler.warnFix"));
  });

  it("is skipped before the first tick", async () => {
    const found = item(await run({ schedulerStatus: () => ({ lastTickAt: null }) }), "scheduler");
    expect(found.status).toBe("skipped");
    expect(found.detail).toBe(copy("zh", "diagnostics.scheduler.skipped"));
  });

  it("fails when reading the status throws", async () => {
    const found = item(
      await run({
        schedulerStatus: () => {
          throw new Error("boom");
        },
      }),
      "scheduler",
    );
    expect(found.status).toBe("fail");
  });
});

describe("the storage checks", () => {
  it("counts the uploads directory", async () => {
    const found = item(await run(), "storage.uploads");
    expect(found.status).toBe("ok");
    expect(found.detail).toContain("12");
    expect(found.detail).toContain("KB");
  });

  it("says 'over 50,000' rather than walking the whole directory", async () => {
    const found = item(
      await run({ measureUploads: async () => ({ files: 50_000, bytes: 1, capped: true }) }),
      "storage.uploads",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toContain("超过");
    expect(found.detail).toContain("5 万");
  });

  it("fails when the uploads walk throws", async () => {
    const found = item(
      await run({
        measureUploads: async () => {
          throw new Error("EACCES");
        },
      }),
      "storage.uploads",
    );
    expect(found.status).toBe("fail");
  });

  it("reports the database size", async () => {
    const found = item(await run(), "storage.database");
    expect(found.status).toBe("ok");
    expect(found.detail).toContain("MB");
  });

  it("is skipped when there is no database", async () => {
    const found = item(
      await run({ databaseSizeBytes: async () => null }),
      "storage.database",
    );
    expect(found.status).toBe("skipped");
    expect(found.detail).toBe(copy("zh", "diagnostics.storage.dbSkipped"));
  });

  it("fails when the size query throws", async () => {
    const found = item(
      await run({
        databaseSizeBytes: async () => {
          throw new Error("db");
        },
      }),
      "storage.database",
    );
    expect(found.status).toBe("fail");
  });

  it("reports the free disk", async () => {
    const found = item(await run(), "storage.disk");
    expect(found.status).toBe("ok");
    expect(found.detail).toContain("GB");
  });

  it("warns when the disk is nearly full", async () => {
    const found = item(
      await run({
        diskSpace: async () => ({
          freeBytes: LOW_DISK_BYTES / 2,
          totalBytes: 500 * 1024 ** 3,
        }),
      }),
      "storage.disk",
    );
    expect(found.status).toBe("warn");
    expect(found.detail).toBe(
      copy("zh", "diagnostics.storage.diskWarn", { free: "512.0 MB" }),
    );
    expect(found.fix).toBe(copy("zh", "diagnostics.storage.diskWarnFix"));
  });

  it("fails when the disk cannot be read", async () => {
    const found = item(
      await run({
        diskSpace: async () => {
          throw new Error("statfs");
        },
      }),
      "storage.disk",
    );
    expect(found.status).toBe("fail");
  });
});

describe("one check failing", () => {
  it("does not stop the others", async () => {
    const broken = await run({
      pingDatabase: async () => {
        throw new Error("db");
      },
      hasFfmpeg: async () => {
        throw new Error("ffmpeg");
      },
      diskSpace: async () => {
        throw new Error("disk");
      },
    });
    const healthy = await run();
    expect(broken.items).toHaveLength(healthy.items.length);
    expect(item(broken, "database").status).toBe("fail");
    expect(item(broken, "migrations").status).toBe("ok");
    expect(item(broken, "redis").status).toBe("skipped");
    expect(item(broken, "storage.disk").status).toBe("fail");
  });

  it("turns a check that never answers into a fail, and still reports the rest", async () => {
    const result = await run(
      {
        hasFfmpeg: () => new Promise<boolean>(() => {}),
      },
      20,
    );
    const found = item(result, "ffmpeg");
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(copy("zh", "diagnostics.timeout", { seconds: 1 }));
    expect(found.fix).toBe(copy("zh", "diagnostics.timeoutFix"));
    expect(item(result, "database").status).toBe("ok");
    expect(item(result, "storage.disk").status).toBe("ok");
  });

  it("turns a check whose dependency throws into a fail without quoting it", async () => {
    const found = item(
      await run({
        hasFfmpeg: async () => {
          throw new Error("EACCES: /Users/someone/private/ffmpeg");
        },
      }),
      "ffmpeg",
    );
    expect(found.status).toBe("fail");
    expect(found.detail).toBe(copy("zh", "diagnostics.error"));
    expect(found.detail).not.toContain("/Users/");
    expect(found.fix).toBe(copy("zh", "diagnostics.errorFix"));
  });
});

describe("the report", () => {
  /** Values a report must never carry, whatever a dependency says. */
  const SECRET = "sk-live-SENTINEL-KEY";
  const MESSAGE = "sentinel message content";
  const USERNAME = "sentinel-username";
  const ABSOLUTE = "/Users/sentinel/private/notes.txt";

  it("is the list, in the same order, with the fixes", () => {
    const items: DiagnoseItem[] = [
      { id: "ok.item", status: "ok", detail: "fine" },
      { id: "skipped.item", status: "skipped", detail: "not checked" },
      { id: "fail.item", status: "fail", detail: "broken", fix: "fix it" },
      { id: "warn.item", status: "warn", detail: "meh" },
    ];
    const report = formatDiagnoseReport(items, labels);
    expect(report.split("\n")[0]).toBe("report");
    const order = ["fail.item", "warn.item", "ok.item", "skipped.item"];
    const positions = order.map((id) => report.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(report).toContain("fix: fix it");
    // The sort is the shared one, so the report order is the list order.
    expect(sortDiagnoseItems(items).map((entry) => entry.id)).toEqual(order);
  });

  it("never carries a key, message content, a username or an absolute path", async () => {
    const result = await run({
      // The database is down — that is a state, not an exception — so the
      // report still has its specific sentence rather than the generic one.
      pingDatabase: async () => "unreachable",
      // A driver error is exactly where a connection string with a password,
      // an absolute path, or somebody's name ends up.
      hasFfmpeg: async () => {
        throw new Error(`spawn failed ${SECRET} ${MESSAGE} ${USERNAME} ${ABSOLUTE}`);
      },
      listProviders: async () => [
        {
          name: "OpenAI",
          streaming: true,
          vision: false,
          transcribe: false,
          request: async () => {
            throw new Error(`401 ${SECRET} ${MESSAGE} ${USERNAME} ${ABSOLUTE}`);
          },
          // Extra fields, as a real provider object would have.
          apiKey: SECRET,
          lastError: MESSAGE,
          owner: USERNAME,
        } as never,
      ],
      readMigrationVersions: async () => ({
        latest: "0078_soft_delete",
        applied: "0078_soft_delete",
        reachable: true,
        directory: ABSOLUTE,
        appliedBy: USERNAME,
      }),
      channelStatuses: async () =>
        [
          {
            channel: "wechat",
            status: "error",
            lastError: `${MESSAGE} ${ABSOLUTE}`,
            loggedInUser: USERNAME,
          },
          { channel: "feishu", status: "stopped" },
        ] as never,
      measureUploads: async () =>
        ({ files: 3, bytes: 100, capped: false, path: ABSOLUTE }) as never,
      countPushSubscriptions: async () => {
        throw new Error(`${MESSAGE} ${ABSOLUTE}`);
      },
    });

    const report = formatDiagnoseReport(result.items, labels);
    for (const sentinel of [SECRET, MESSAGE, USERNAME, ABSOLUTE]) {
      expect(report).not.toContain(sentinel);
      expect(JSON.stringify(result.items)).not.toContain(sentinel);
    }
    expect(report).not.toMatch(/\/Users\//);
    // The report is still a report: the failed checks and their fixes are in.
    expect(report).toContain(copy("zh", "diagnostics.database.fail"));
    expect(report).toContain(copy("zh", "diagnostics.provider.fail", { provider: "OpenAI" }));
    expect(report).toContain(copy("zh", "diagnostics.database.failFix"));
  });
});
