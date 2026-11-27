import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDataKey } from "../_core/content-crypto";
import { forgetAllDataKeys, rememberDataKey } from "../_core/data-keys";
import { forgetAllEncryptionStates, setEncryptionEnabled } from "../_core/encrypted-values";

/**
 * An encrypted account's background jobs wait for the next sign-in (C8.5
 * step 5).
 *
 * The scheduler runs for everybody. For an encrypted account whose key
 * is not in this process — a restart, a lock — its letters, replies,
 * proactive messages, capsules, backups and its own enable/disable job
 * would work on ciphertext. They are postponed with one log line instead
 * of throwing, and they resume after the password brings the key back.
 */

const getDueLetters = vi.fn();
const getPersonaById = vi.fn();
const getUserEncryption = vi.fn();
const claimLetter = vi.fn();
const markLetterUnanswered = vi.fn();

vi.mock("../db", () => ({
  getDueLetters: (...a: unknown[]) => getDueLetters(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getUserEncryption: (...a: unknown[]) => getUserEncryption(...a),
  claimLetter: (...a: unknown[]) => claimLetter(...a),
  markLetterUnanswered: (...a: unknown[]) => markLetterUnanswered(...a),
  deferLetter: vi.fn(),
  getLastLetterReplyAt: vi.fn(),
  answerLetterWithMessage: vi.fn(),
  getUserLocale: vi.fn(async () => "zh"),
  createMessage: vi.fn(),
  getUserById: vi.fn(async () => null),
  getMemoriesByPersonaId: vi.fn(async () => []),
  createSafetyEvent: vi.fn(),
  listPushSubscriptions: vi.fn(async () => []),
  getUsersWithPendingEncryptionMigration: vi.fn(async () => []),
}));

const invokeWithProvider = vi.fn();
vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invokeWithProvider(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
    streamWithProvider: () => {
      throw new Error("not used");
    },
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: async () => null,
  resolveProviderForPurpose: async () => null,
  resolveProviderForPurposeWithOwnership: async () => ({
    provider: undefined,
    owned: false,
  }),
  resolveProviderForUserWithOwnership: async () => ({
    provider: undefined,
    owned: false,
  }),
}));

vi.mock("../_core/mail", () => ({
  deliverLetterEmail: vi.fn(async () => undefined),
}));

vi.mock("./retrieval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chat/retrieval")>();
  return { ...actual, retrieveMemories: vi.fn(async () => []) };
});

import { answerDueLetters } from "../chat/letters";
import { isEncryptionLocked, withoutEncryptionLocked } from "./lock";

const encryptedRow = {
  enabled: true,
  wrappedKey: "v1:x:y:z",
  salt: "salt",
  kdf: "scrypt",
};

beforeEach(() => {
  vi.clearAllMocks();
  forgetAllDataKeys();
  forgetAllEncryptionStates();
  getUserEncryption.mockResolvedValue(encryptedRow);
  getDueLetters.mockResolvedValue([
    {
      id: 7,
      userId: 1,
      personaId: 5,
      body: "有件事我一直没说。",
      mood: null,
      status: "waiting",
    },
  ]);
  claimLetter.mockResolvedValue(true);
});

describe("the lock check", () => {
  it("is true only for an encrypted account whose key is not here", async () => {
    expect(await isEncryptionLocked(1)).toBe(true);
    rememberDataKey(1, generateDataKey());
    setEncryptionEnabled(1, true);
    expect(await isEncryptionLocked(1)).toBe(false);
    getUserEncryption.mockResolvedValue(null);
    forgetAllDataKeys();
    expect(await isEncryptionLocked(2)).toBe(false);
  });

  it("filters the locked rows and leaves the others", async () => {
    getUserEncryption.mockImplementation(async (userId: number) =>
      userId === 1 ? encryptedRow : null,
    );
    const kept = await withoutEncryptionLocked(
      [{ userId: 1 }, { userId: 2 }, { userId: 1 }],
      (item) => item.userId,
      "test",
    );
    expect(kept).toEqual([{ userId: 2 }]);
  });
});

describe("a due letter of a locked account", () => {
  it("is not claimed or answered, and the sweep does not throw", async () => {
    const answered = await answerDueLetters(new Date("2024-05-01T12:00:00Z"));
    expect(answered).toBe(0);
    expect(claimLetter).not.toHaveBeenCalled();
    expect(getPersonaById).not.toHaveBeenCalled();
  });

  it("is answered again once the key is back in this process", async () => {
    rememberDataKey(1, generateDataKey());
    setEncryptionEnabled(1, true);
    getPersonaById.mockResolvedValue(undefined);
    const answered = await answerDueLetters(new Date("2024-05-01T12:00:00Z"));
    expect(answered).toBe(0);
    // The sweep got past the lock: it looked the persona up and, since it
    // does not exist, marked the letter unanswered rather than claiming it.
    expect(getPersonaById).toHaveBeenCalledWith(5, 1);
    expect(markLetterUnanswered).toHaveBeenCalledWith(7, 1);
  });
});

describe("the sweeps are wired to the lock", () => {
  const files: Array<[string, string]> = [
    ["server/chat/letters.ts", "withoutEncryptionLocked("],
    ["server/chat/proactive-sweep.ts", "withoutEncryptionLocked("],
    ["server/chat/reply-jobs.ts", "withoutEncryptionLocked("],
    ["server/scheduler/scheduled-items.ts", "withoutEncryptionLocked("],
    ["server/scheduler/reminders.ts", "withoutEncryptionLocked("],
    // The backup sweep checks each user inside its loop instead of
    // filtering a due list, so it calls the single-item check — through
    // an injectable dependency (P18.3: a unit test must not read the
    // database just because DATABASE_URL happens to be set) whose default
    // is still the real one.
    ["server/backup/schedule.ts", "const locked = deps?.locked ?? isEncryptionLocked"],
  ];
  const root = path.resolve(__dirname, "..", "..");
  for (const [file, marker] of files) {
    it(`${file} filters its due rows`, () => {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source).toContain(marker);
    });
  }

  it("the scheduler resumes interrupted migrations", () => {
    const source = readFileSync(path.join(root, "server/scheduler/index.ts"), "utf8");
    expect(source).toContain("resumeEncryptionMigrations");
  });
});
