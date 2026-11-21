import { describe, expect, it, vi } from "vitest";
import { runScheduledBackups, type ScheduledBackupUser } from "./backup/schedule";
import { BackupDeliveryError } from "./backup/targets";
import type { BackupSettings } from "@shared/backup";

const NOW = new Date("2026-11-21T03:00:00Z");

function folderSettings(overrides: Partial<BackupSettings> = {}): BackupSettings {
  return {
    enabled: true,
    frequency: "daily",
    target: { kind: "folder", path: "/tmp/mirrai-backups" },
    passphraseSecret: "v1:wrapped",
    ...overrides,
  };
}

function harness(users: ScheduledBackupUser[]) {
  const saved: Array<{ userId: number; settings: BackupSettings }> = [];
  const create = vi.fn(async (options: { out: string }) => {
    await import("node:fs").then((fs) => fs.promises.writeFile(options.out, Buffer.from("BACKUP")));
    return {
      file: options.out,
      bytes: 6,
      sha256: "a".repeat(64),
      manifest: { tables: [], uploads: [], exclusions: [] },
    };
  });
  const deliver = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const deps = {
    getUsers: async () => users,
    saveSettings: async (userId: number, settings: BackupSettings) => {
      saved.push({ userId, settings });
      return true;
    },
    create: create as never,
    deliver: deliver as never,
    remove: remove as never,
    decrypt: async (_payload: string | null | undefined) => "the-passphrase",
    now: () => NOW,
  };
  return { deps, saved, create, deliver, remove };
}

describe("the scheduled backup", () => {
  it("runs a due backup, records the file, and keeps the last seven", async () => {
    const history = Array.from({ length: 7 }, (_, index) => `old-${index}.mirrai-backup`);
    const { deps, saved, deliver, remove } = harness([
      { id: 1, backupSettings: folderSettings({ history }) },
    ]);
    const result = await runScheduledBackups(NOW, deps);
    expect(result).toEqual({ ran: 1, failed: 0 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].settings.lastRunAt).toBe(NOW.toISOString());
    expect(saved[0].settings.lastFileName).toMatch(/^mirrai-backup-.*\.mirrai-backup$/);
    expect(saved[0].settings.history).toHaveLength(7);
    expect(saved[0].settings.history![0]).toBe("old-1.mirrai-backup");
    // The oldest name was deleted from the destination.
    expect(remove).toHaveBeenCalledTimes(1);
    expect((remove.mock.calls[0] as unknown[])[0]).toMatchObject({
      fileName: "old-0.mirrai-backup",
    });
  });

  it("does nothing when the last run was less than a day ago", async () => {
    const recent = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    const { deps, saved, deliver } = harness([
      { id: 1, backupSettings: folderSettings({ lastRunAt: recent }) },
    ]);
    expect(await runScheduledBackups(NOW, deps)).toEqual({ ran: 0, failed: 0 });
    expect(deliver).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("runs a weekly backup only after a week", async () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    const { deps } = harness([
      { id: 1, backupSettings: folderSettings({ frequency: "weekly", lastRunAt: twoDaysAgo }) },
    ]);
    expect(await runScheduledBackups(NOW, deps)).toEqual({ ran: 0, failed: 0 });
  });

  it("records the error token when the archive cannot be made", async () => {
    const { deps, saved } = harness([{ id: 1, backupSettings: folderSettings() }]);
    deps.create = vi.fn(async () => {
      throw new Error("disk full");
    }) as never;
    const result = await runScheduledBackups(NOW, deps);
    expect(result).toEqual({ ran: 0, failed: 1 });
    expect(saved[0].settings.lastError).toBe("backup_failed");
  });

  it("records the delivery reason when the destination refuses", async () => {
    const { deps, saved } = harness([{ id: 1, backupSettings: folderSettings() }]);
    deps.deliver = vi.fn(async () => {
      throw new BackupDeliveryError("http_failed", 401);
    }) as never;
    const result = await runScheduledBackups(NOW, deps);
    expect(result).toEqual({ ran: 0, failed: 1 });
    expect(saved[0].settings.lastError).toBe("http_failed");
  });

  it("skips a remote target whose stored passphrase cannot be opened", async () => {
    const { deps, saved, create, deliver } = harness([
      {
        id: 1,
        backupSettings: folderSettings({
          target: { kind: "webdav", url: "https://dav.example.com/x", username: "me" },
        }),
      },
    ]);
    deps.decrypt = (async () => null) as never;
    const result = await runScheduledBackups(NOW, deps);
    expect(result).toEqual({ ran: 0, failed: 1 });
    expect(saved[0].settings.lastError).toBe("passphrase_missing");
    expect(create).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("does not let one user's failure stop the next user", async () => {
    const { deps, saved } = harness([
      { id: 1, backupSettings: folderSettings() },
      { id: 2, backupSettings: folderSettings({ target: { kind: "folder", path: "/tmp/b" } }) },
    ]);
    let call = 0;
    deps.create = vi.fn(async (options: { out: string }) => {
      call += 1;
      if (call === 1) throw new Error("first fails");
      await import("node:fs").then((fs) => fs.promises.writeFile(options.out, Buffer.from("B")));
      return {
        file: options.out,
        bytes: 1,
        sha256: "b".repeat(64),
        manifest: { tables: [], uploads: [], exclusions: [] },
      };
    }) as never;
    const result = await runScheduledBackups(NOW, deps);
    expect(result).toEqual({ ran: 1, failed: 1 });
    expect(saved.map((row) => row.userId)).toEqual([1, 2]);
  });

  it("passes the decrypted credentials to the destination", async () => {
    const target = {
      kind: "s3" as const,
      endpoint: "https://s3.example.com",
      bucket: "b",
      region: "us-east-1",
      accessKeyId: "AK",
      secretAccessKeySecret: "v1:wrapped-secret",
    };
    const { deps, deliver } = harness([{ id: 1, backupSettings: folderSettings({ target }) }]);
    deps.decrypt = (async (payload: string | null | undefined) =>
      payload === "v1:wrapped-secret" ? "the-secret" : "the-pass") as never;
    await runScheduledBackups(NOW, deps);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { secretAccessKey: "the-secret" } }),
    );
  });
});

describe("the error token", () => {
  it("is cleared by a successful run", async () => {
    const { deps, saved } = harness([
      {
        id: 1,
        backupSettings: folderSettings({ lastError: "backup_failed" }),
      },
    ]);
    const result = await runScheduledBackups(NOW, deps);
    expect(result).toEqual({ ran: 1, failed: 0 });
    expect(saved).toHaveLength(1);
    expect(saved[0].settings.lastError).toBeUndefined();
  });
});
