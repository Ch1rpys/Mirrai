import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The user's own diary, as routes (C4.5).
 *
 * It is private in the ordinary way: every helper takes the caller's id,
 * and a row that is not theirs is not found. The default day is the
 * writer's own day, not the server's.
 */
const getPersonaById = vi.fn();
const createJournalEntry = vi.fn();
const listJournalEntries = vi.fn();
const getJournalEntryById = vi.fn();
const updateJournalEntry = vi.fn();
const deleteJournalEntry = vi.fn();
const createSafetyEvent = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createJournalEntry: (...a: unknown[]) => createJournalEntry(...a),
  listJournalEntries: (...a: unknown[]) => listJournalEntries(...a),
  getJournalEntryById: (...a: unknown[]) => getJournalEntryById(...a),
  updateJournalEntry: (...a: unknown[]) => updateJournalEntry(...a),
  deleteJournalEntry: (...a: unknown[]) => deleteJournalEntry(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
}));

import { appRouter } from "./routers";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("journal routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    createJournalEntry.mockResolvedValue(7);
    listJournalEntries.mockResolvedValue([{ id: 7, body: "今天" }]);
    getJournalEntryById.mockResolvedValue({ id: 7, userId: 1, body: "今天" });
    updateJournalEntry.mockResolvedValue(true);
    createSafetyEvent.mockResolvedValue(1);
    deleteJournalEntry.mockResolvedValue(true);
  });

  it("writes an entry, defaulting to the writer's own day", async () => {
    await appRouter.createCaller(ctxFor(1)).journal.create({ body: "今天想起第一次见面。" });
    expect(createJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        body: "今天想起第一次见面。",
        entryDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("refuses a persona the caller does not own", async () => {
    getPersonaById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(2)).journal.create({ personaId: 5, body: "今天" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(createJournalEntry).not.toHaveBeenCalled();
  });

  it("lists only the caller's own entries", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).journal.list({});
    expect(listJournalEntries).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, personaId: null }),
    );
    expect(result.entries).toHaveLength(1);
  });

  it("stops and shows the crisis card when the entry is a crisis (C4.5)", async () => {
    // The diary is the most private free writing in the app; the words
    // are read by the crisis detector and a hit shows the card instead
    // of saving.
    const result = await appRouter
      .createCaller(ctxFor(1))
      .journal.create({ body: "我不想活了" });
    expect(result).toMatchObject({ crisis: true });
    expect(createJournalEntry).not.toHaveBeenCalled();
    expect(createSafetyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, type: "crisis" }),
    );
  });

  it("stops and shows the crisis card when the edit is a crisis (C4.5)", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .journal.update({ id: 7, body: "我不想活了" });
    expect(result).toMatchObject({ crisis: true });
    expect(updateJournalEntry).not.toHaveBeenCalled();
    expect(createSafetyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, type: "crisis" }),
    );
  });

  it("does not edit or delete somebody else's entry", async () => {
    getJournalEntryById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(2)).journal.update({ id: 7, body: "改" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    deleteJournalEntry.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(ctxFor(2)).journal.delete({ id: 7 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
