import { beforeEach, describe, expect, it, vi } from "vitest";

const listDueScheduledItems = vi.fn();
const claimScheduledItem = vi.fn();
const finishScheduledItem = vi.fn();
const releaseScheduledItem = vi.fn();
const getPersonaById = vi.fn();
const getUserById = vi.fn();
const createLetterWithMessage = vi.fn();
const createSafetyEvent = vi.fn();
const pushToUser = vi.fn();
const runConversation = vi.fn();
const getLastUserMessageAt = vi.fn();
const createMessage = vi.fn();
const composeCheckInMessage = vi.fn();

vi.mock("../db", () => ({
  listDueScheduledItems: (...args: unknown[]) => listDueScheduledItems(...args),
  claimScheduledItem: (...args: unknown[]) => claimScheduledItem(...args),
  finishScheduledItem: (...args: unknown[]) => finishScheduledItem(...args),
  releaseScheduledItem: (...args: unknown[]) => releaseScheduledItem(...args),
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  getUserById: (...args: unknown[]) => getUserById(...args),
  createLetterWithMessage: (...args: unknown[]) => createLetterWithMessage(...args),
  createSafetyEvent: (...args: unknown[]) => createSafetyEvent(...args),
  getLastUserMessageAt: (...args: unknown[]) => getLastUserMessageAt(...args),
  createMessage: (...args: unknown[]) => createMessage(...args),
}));

vi.mock("../chat/service", () => ({
  runConversation: (...args: unknown[]) => runConversation(...args),
}));

vi.mock("../chat/checkin", () => ({
  composeCheckInMessage: (...args: unknown[]) => composeCheckInMessage(...args),
}));

vi.mock("../_core/push", () => ({
  pushToUser: (...args: unknown[]) => pushToUser(...args),
}));

import { sweepScheduledItems } from "./scheduled-items";

const NOW = new Date("2026-03-01T12:00:00Z");

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    userId: 1,
    personaId: 1,
    kind: "message",
    body: "到那天再说",
    dueAt: new Date("2026-03-01T00:00:00Z"),
    status: "scheduled",
    cancelReason: null,
    claimedAt: null,
    deliveredAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function persona(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小满",
    settings: {},
    presence: "active",
    graduationStatus: "active",
    timezone: "Asia/Shanghai",
    ...overrides,
  };
}

/** An async generator that can stand in for `runConversation`. */
async function* events(lines: string[]) {
  for (const line of lines) {
    yield { type: "delta", text: line } as const;
  }
  yield { type: "done" } as const;
}

describe("delivering what was scheduled (C5.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDueScheduledItems.mockResolvedValue([item()]);
    claimScheduledItem.mockResolvedValue(true);
    finishScheduledItem.mockResolvedValue(true);
    releaseScheduledItem.mockResolvedValue(true);
    getPersonaById.mockResolvedValue(persona());
    getUserById.mockResolvedValue({ id: 1, locale: "zh", timezone: "Asia/Shanghai" });
    createLetterWithMessage.mockResolvedValue({ id: 3 });
    createSafetyEvent.mockResolvedValue(1);
    pushToUser.mockResolvedValue(1);
    runConversation.mockImplementation(async function* () {
      yield* events(["在的"]);
    });
    getLastUserMessageAt.mockResolvedValue(null);
    createMessage.mockResolvedValue(41);
    composeCheckInMessage.mockResolvedValue("到家了吗");
  });

  it("opens a capsule on its day without a model call", async () => {
    listDueScheduledItems.mockResolvedValue([item({ kind: "capsule", body: "给以后的自己" })]);
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 1, cancelled: 0 });
    expect(finishScheduledItem).toHaveBeenCalledWith(7, 1, "delivered", { at: NOW });
    expect(runConversation).not.toHaveBeenCalled();
    expect(pushToUser).not.toHaveBeenCalled();
  });

  it("puts a scheduled message into the conversation and pushes the answer", async () => {
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 1, cancelled: 0 });
    expect(runConversation).toHaveBeenCalledWith(expect.objectContaining({
      message: "到那天再说",
      userId: 1,
      mode: "once",
      now: NOW,
      // The answer arrives while the user is away, so the mailbox has to
      // be able to count it (C8.2).
      fromScheduledMessage: true,
    }));
    expect(finishScheduledItem).toHaveBeenCalledWith(7, 1, "delivered", { at: NOW });
    expect(pushToUser).toHaveBeenCalledWith(1, expect.objectContaining({
      kind: "reply",
      personaId: 1,
      text: "在的",
    }));
  });

  it("delivers once when two sweeps run together", async () => {
    claimScheduledItem
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const [first, second] = await Promise.all([
      sweepScheduledItems(NOW),
      sweepScheduledItems(NOW),
    ]);
    expect(runConversation).toHaveBeenCalledTimes(1);
    expect(finishScheduledItem).toHaveBeenCalledTimes(1);
    expect(first.delivered + second.delivered).toBe(1);
  });

  it("cancels when the persona is asleep, and calls no model", async () => {
    getPersonaById.mockResolvedValue(persona({ graduationStatus: "graduated" }));
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 0, cancelled: 1 });
    expect(finishScheduledItem).toHaveBeenCalledWith(7, 1, "cancelled", { reason: "asleep" });
    expect(runConversation).not.toHaveBeenCalled();
  });

  it("cancels while the persona is sealed", async () => {
    getPersonaById.mockResolvedValue(persona({
      settings: { seal: { until: "2099-01-01", earlyOpen: "never" } },
    }));
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 0, cancelled: 1 });
    expect(finishScheduledItem).toHaveBeenCalledWith(7, 1, "cancelled", { reason: "sealed" });
  });

  it("cancels when the persona is gone", async () => {
    getPersonaById.mockResolvedValue(null);
    await sweepScheduledItems(NOW);
    expect(finishScheduledItem).toHaveBeenCalledWith(7, 1, "cancelled", { reason: "deleted" });
  });

  it("turns a scheduled letter into a letter at the normal reply pace", async () => {
    listDueScheduledItems.mockResolvedValue([item({ kind: "letter", body: "一封信" })]);
    await sweepScheduledItems(NOW);
    expect(createLetterWithMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        personaId: 1,
        body: "一封信",
        kind: "letter",
        status: "waiting",
      }),
      expect.objectContaining({ personaId: 1, userId: 1, content: "一封信" }),
    );
    expect(finishScheduledItem).toHaveBeenCalledWith(7, 1, "delivered", { at: NOW });
  });

  it("reads a scheduled message for crisis language at delivery", async () => {
    listDueScheduledItems.mockResolvedValue([item({ body: "我不想活了" })]);
    await sweepScheduledItems(NOW);
    expect(createSafetyEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      personaId: 1,
      type: "crisis",
    }));
    // It is still delivered: the conversation answers it immediately.
    expect(runConversation).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when the turn fails, so a later sweep retries", async () => {
    runConversation.mockImplementation(async function* () {
      throw new Error("the provider is down");
    });
    const result = await sweepScheduledItems(NOW);
    expect(result.delivered).toBe(0);
    expect(releaseScheduledItem).toHaveBeenCalledWith(7, 1);
    expect(finishScheduledItem).not.toHaveBeenCalled();
  });
});

describe("the reminder the persona agreed to bring up (C9.4)", () => {
  function checkIn(overrides: Record<string, unknown> = {}) {
    return item({
      kind: "check_in",
      body: "到家了跟我说",
      createdAt: new Date("2026-03-01T10:00:00Z"),
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    listDueScheduledItems.mockResolvedValue([checkIn()]);
    claimScheduledItem.mockResolvedValue(true);
    finishScheduledItem.mockResolvedValue(true);
    releaseScheduledItem.mockResolvedValue(true);
    getPersonaById.mockResolvedValue(persona());
    getUserById.mockResolvedValue({ id: 1, locale: "zh", timezone: "Asia/Shanghai" });
    createSafetyEvent.mockResolvedValue(1);
    pushToUser.mockResolvedValue(1);
    getLastUserMessageAt.mockResolvedValue(null);
    createMessage.mockResolvedValue(41);
    composeCheckInMessage.mockResolvedValue("到家了吗");
  });

  it("asks one line and marks it as a check-in", async () => {
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 1, cancelled: 0 });
    expect(composeCheckInMessage).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      reminderText: "到家了跟我说",
      locale: "zh",
      now: NOW,
    }));
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 1,
      userId: 1,
      role: "assistant",
      content: "到家了吗",
      channel: "web",
      metadata: { kind: "check_in", reminderText: "到家了跟我说" },
    }));
    expect(finishScheduledItem).toHaveBeenCalledWith(7, 1, "delivered", { at: NOW });
    expect(pushToUser).toHaveBeenCalledWith(1, expect.objectContaining({ text: "到家了吗" }));
  });

  it("cancels it without a word when the user wrote in the meantime", async () => {
    getLastUserMessageAt.mockResolvedValue(new Date("2026-03-01T11:30:00Z"));
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 0, cancelled: 1 });
    expect(composeCheckInMessage).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
    expect(finishScheduledItem).toHaveBeenCalledWith(7, 1, "cancelled", { reason: "closed" });
  });

  it("delivers when the last thing the user said was before the reminder", async () => {
    getLastUserMessageAt.mockResolvedValue(new Date("2026-03-01T09:00:00Z"));
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 1, cancelled: 0 });
  });

  it("waits out the quiet hours instead of waking the user", async () => {
    // 16:30 UTC is 00:30 in Shanghai, inside the default 23:00-08:00.
    const lateNight = new Date("2026-03-01T16:30:00Z");
    const result = await sweepScheduledItems(lateNight);
    expect(result).toEqual({ delivered: 0, cancelled: 0 });
    expect(releaseScheduledItem).toHaveBeenCalledWith(7, 1);
    expect(composeCheckInMessage).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("is cancelled in a memorial persona", async () => {
    getPersonaById.mockResolvedValue(persona({ settings: { mode: "memorial" } }));
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 0, cancelled: 1 });
    expect(composeCheckInMessage).not.toHaveBeenCalled();
  });

  it("records that a crisis line was saved as a reminder, and does not send it", async () => {
    listDueScheduledItems.mockResolvedValue([checkIn({ body: "我不想活了" })]);
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 0, cancelled: 1 });
    expect(createSafetyEvent).toHaveBeenCalled();
    expect(composeCheckInMessage).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("gives it back when no provider could write the line", async () => {
    composeCheckInMessage.mockResolvedValue(null);
    const result = await sweepScheduledItems(NOW);
    expect(result).toEqual({ delivered: 0, cancelled: 0 });
    expect(releaseScheduledItem).toHaveBeenCalledWith(7, 1);
    expect(finishScheduledItem).not.toHaveBeenCalled();
  });
});
