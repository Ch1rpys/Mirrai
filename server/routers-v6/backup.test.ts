import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { copy } from "@shared/copy";

const getUserBackupSettings = vi.fn();
const setUserBackupSettings = vi.fn();

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserBackupSettings: (...a: unknown[]) => getUserBackupSettings(...a),
  setUserBackupSettings: (...a: unknown[]) => setUserBackupSettings(...a),
}));

import { appRouter } from "../routers";

function ctxFor(userId: number, locale: "zh" | "en" = "zh"): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      name: null,
      email: null,
      loginMethod: null,
      role: "user",
      tokenVersion: 0,
      graduationMode: "suggest",
      timezone: null,
      locale,
      addressStyle: null,
      trajectoryAssessment: "auto",
      boundaries: null,
      budget: null,
      backupSettings: null,
      lockPinHash: null,
      lockSettings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    locale,
  };
}

const caller = (userId: number, locale: "zh" | "en" = "zh") =>
  appRouter.createCaller(ctxFor(userId, locale));

describe("backup.getSettings", () => {
  beforeEach(() => {
    getUserBackupSettings.mockReset();
    setUserBackupSettings.mockReset();
  });

  it("returns the defaults without any secret", async () => {
    getUserBackupSettings.mockResolvedValue(null);
    const settings = await caller(7).backup.getSettings();
    expect(settings).toEqual({
      enabled: false,
      frequency: "daily",
      hasPassphrase: false,
      hasTargetPassword: false,
      hasTargetSecretAccessKey: false,
    });
  });

  it("never sends the wrapped secrets back", async () => {
    getUserBackupSettings.mockResolvedValue({
      enabled: true,
      frequency: "weekly",
      target: {
        kind: "webdav",
        url: "https://dav.example.com/x",
        username: "me",
        passwordSecret: "v1:secret",
      },
      passphraseSecret: "v1:pass",
    });
    const settings = await caller(7).backup.getSettings();
    expect(settings.hasPassphrase).toBe(true);
    expect(settings.hasTargetPassword).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("v1:");
    expect(settings.target).toEqual({
      kind: "webdav",
      url: "https://dav.example.com/x",
      username: "me",
    });
  });
});

describe("backup.updateSettings", () => {
  beforeEach(() => {
    getUserBackupSettings.mockReset();
    setUserBackupSettings.mockReset();
    setUserBackupSettings.mockResolvedValue(true);
  });

  it("saves a folder target and wraps the passphrase", async () => {
    getUserBackupSettings.mockResolvedValue(null);
    await caller(7).backup.updateSettings({
      enabled: true,
      frequency: "daily",
      target: { kind: "folder", path: "/Users/me/Mirrai backups" },
      passphrase: "correct horse battery",
    });
    const saved = setUserBackupSettings.mock.calls[0][1];
    expect(saved.enabled).toBe(true);
    expect(saved.target).toEqual({ kind: "folder", path: "/Users/me/Mirrai backups" });
    expect(saved.passphraseSecret).toMatch(/^v1:/);
    expect(saved.passphraseSecret).not.toContain("correct horse battery");
  });

  it("refuses to be on with no destination", async () => {
    getUserBackupSettings.mockResolvedValue(null);
    await expect(
      caller(7).backup.updateSettings({ enabled: true, frequency: "daily" }),
    ).rejects.toThrow(copy("zh", "backup.errorTargetRequired"));
  });

  it("refuses a remote target with no passphrase", async () => {
    getUserBackupSettings.mockResolvedValue(null);
    await expect(
      caller(7).backup.updateSettings({
        enabled: true,
        frequency: "daily",
        target: { kind: "webdav", url: "https://dav.example.com/x", username: "me" },
      }),
    ).rejects.toThrow(copy("zh", "backup.errorRemotePassphrase"));
  });

  it("refuses a relative folder path", async () => {
    getUserBackupSettings.mockResolvedValue(null);
    await expect(
      caller(7).backup.updateSettings({
        enabled: true,
        frequency: "daily",
        target: { kind: "folder", path: "backups" },
        passphrase: "correct horse battery",
      }),
    ).rejects.toThrow(copy("zh", "backup.errorFolderPath"));
  });

  it("keeps stored credentials when unrelated fields change", async () => {
    getUserBackupSettings.mockResolvedValue({
      enabled: true,
      frequency: "daily",
      target: {
        kind: "s3",
        endpoint: "https://s3.example.com",
        bucket: "b",
        region: "us-east-1",
        accessKeyId: "AK",
        secretAccessKeySecret: "v1:secret",
      },
      passphraseSecret: "v1:pass",
    });
    await caller(7).backup.updateSettings({
      enabled: false,
      frequency: "weekly",
      target: {
        kind: "s3",
        endpoint: "https://s3.example.com",
        bucket: "b",
        region: "us-east-1",
        accessKeyId: "AK",
      },
    });
    const saved = setUserBackupSettings.mock.calls[0][1];
    expect(saved.enabled).toBe(false);
    expect(saved.target.secretAccessKeySecret).toBe("v1:secret");
    expect(saved.passphraseSecret).toBe("v1:pass");
  });

  it("clears the passphrase when asked", async () => {
    getUserBackupSettings.mockResolvedValue({
      enabled: false,
      frequency: "daily",
      target: { kind: "folder", path: "/tmp/b" },
      passphraseSecret: "v1:pass",
    });
    await caller(7).backup.updateSettings({
      enabled: false,
      frequency: "daily",
      target: { kind: "folder", path: "/tmp/b" },
      clearPassphrase: true,
    });
    const saved = setUserBackupSettings.mock.calls[0][1];
    expect(saved.passphraseSecret).toBeUndefined();
  });
});
