import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The bridge between a channel and a persona.
 *
 * It is the one place that knows how a conversation behaves outside the
 * web interface, and it is where the two notes about the farewell used
 * to collide: the bridge appended one and each channel appended another,
 * so the user received two instructions to type "/毕业" at the end of
 * one message.
 */
const getPersonaById = vi.fn();
const getUserTimezone = vi.fn();
const runConversation = vi.fn();
const claimSilenceNotice = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
}));

vi.mock("../chat/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../chat/service")>();
  return {
    ...actual,
    runConversation: (...a: unknown[]) => runConversation(...a),
  };
});

vi.mock("../chat/silence-notice", () => ({
  claimSilenceNotice: (...a: unknown[]) => claimSilenceNotice(...a),
}));

import { handleChannelChat, sendChannelParts } from "./bridge";
import { ChatClosedError } from "../chat/service";
import { copy } from "@shared/copy";
import { fallbackChannelGapMs } from "../chat/inbox";

/** The events a conversation yields when it answers. */
async function* answers(text: string, graduationSuggested = false) {
  yield { type: "delta", text };
  yield { type: "done", messageId: 1, graduationSuggested };
}

async function* burst(texts: string[], graduationSuggested = false, gapsMs?: number[]) {
  yield { type: "burst", texts, ...(gapsMs ? { gapsMs } : {}) };
  yield { type: "done", messageId: 1, graduationSuggested };
}

describe("the bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({
      id: 7,
      name: "小A",
      analysisStatus: "ready",
      graduationStatus: null,
    });
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    claimSilenceNotice.mockResolvedValue(true);
  });

  it("says the taper notice once a day on a channel (C6.1)", async () => {
    runConversation.mockImplementation(async function* () {
      throw new ChatClosedError("今天不是周末。这是你自己定的：只在周末和 小A 聊。");
    });
    claimSilenceNotice.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
    });
    expect(first?.parts[0]).toContain("只在周末");
    expect(claimSilenceNotice).toHaveBeenNthCalledWith(1, 1, 7, expect.any(String));

    const second = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
    });
    expect(second).toBeNull();
  });

  it("mentions the ritual once when the app has decided a farewell is due", async () => {
    runConversation.mockImplementation(() => answers("在的。", true));

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    const note = copy("zh", "channels.graduationNote");
    expect(reply?.parts).toHaveLength(1);
    expect(reply?.parts[0]).toContain(note);
    expect(reply!.parts[0]!.split(note).length - 1).toBe(1);
  });

  it("mentions the ritual once when the persona is already waiting for one", async () => {
    getPersonaById.mockResolvedValue({
      id: 7,
      name: "小A",
      analysisStatus: "ready",
      graduationStatus: "suggested",
    });
    runConversation.mockImplementation(() => answers("在的。"));

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    const note = copy("zh", "channels.graduationNote");
    expect(reply?.parts[0]).toContain(note);
    expect(reply!.parts[0]!.split(note).length - 1).toBe(1);
  });

  it("says nothing when a later message took the turn away", async () => {
    async function* superseded() {
      yield { type: "superseded" };
    }
    runConversation.mockImplementation(() => superseded());

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    expect(reply).toBeNull();
  });

  it("says nothing about the ritual when no farewell is due", async () => {
    runConversation.mockImplementation(() => answers("在的。"));

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    expect(reply).toEqual({ parts: ["在的。"], gapsMs: [] });
  });

  it("keeps a burst as separate parts", async () => {
    runConversation.mockImplementation(() => burst(["嗯", "好", "在"]));

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    expect(reply?.parts).toEqual(["嗯", "好", "在"]);
    expect(reply?.gapsMs).toHaveLength(2);
    expect(reply?.gapsMs[0]).toBe(fallbackChannelGapMs("好"));
    expect(reply?.gapsMs[1]).toBe(fallbackChannelGapMs("在"));
  });

  it("passes a crisis line through the ordinary conversation (WP12)", async () => {
    // The channel is not a way around the safety layer: the same
    // runConversation reads the message, so the support answer comes
    // from the same place as on the web.
    const support = copy("zh", "safety.crisisStop");
    runConversation.mockImplementation(async function* () {
      yield { type: "delta", text: support };
      yield { type: "done", messageId: 1, graduationSuggested: false };
    });
    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_1",
      personaId: 5,
      messageText: "我不想活了",
      channel: "feishu",
    });
    expect(runConversation).toHaveBeenCalledWith(expect.objectContaining({
      message: "我不想活了",
      channel: "feishu",
    }));
    expect(reply?.parts.join("")).toContain(support);
  });

  it("returns nothing for a deferred turn (B5.8)", async () => {
    // The reply will come later as the job's own message; the channel
    // must not send half of it now.
    runConversation.mockImplementation(async function* () {
      yield { type: "deferred", jobId: 3, dueAt: new Date().toISOString(), reason: "delay" };
    });
    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_1",
      personaId: 5,
      messageText: "在吗",
      channel: "feishu",
    });
    expect(reply).toBeNull();
  });

  it("keeps a single line as one part", async () => {
    runConversation.mockImplementation(() => answers("在的。"));

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    expect(reply?.parts).toEqual(["在的。"]);
    expect(reply?.gapsMs).toEqual([]);
  });

  it("puts the farewell note only on the last bubble of a burst", async () => {
    runConversation.mockImplementation(() => burst(["嗯", "好", "在"], true));

    const reply = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });

    const note = copy("zh", "channels.graduationNote");
    expect(reply?.parts[0]).toBe("嗯");
    expect(reply?.parts[1]).toBe("好");
    expect(reply?.parts[2]).toContain(note);
    expect(reply?.parts[0]).not.toContain(note);
  });

  it("claims the silence notice on the reader's day, not the persona's", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-06-01T17:00:00.000Z")); // 01:00 on June 2 in Shanghai
      getPersonaById.mockResolvedValue({
        id: 7,
        name: "小A",
        analysisStatus: "ready",
        timezone: "UTC",
        graduationStatus: null,
      });
      getUserTimezone.mockResolvedValue("Asia/Shanghai");
      async function* silent() {
        yield { type: "silence", notice: "这次先不回了。" };
        yield { type: "done", messageId: 1, graduationSuggested: false };
      }
      runConversation.mockImplementation(() => silent());

      const reply = await handleChannelChat({
        userId: 1,
        conversationKey: "oc_abc",
        personaId: 7,
        messageText: "在吗",
        channel: "feishu",
        locale: "zh",
      });

      expect(reply?.parts).toEqual(["这次先不回了。"]);
      expect(claimSilenceNotice).toHaveBeenCalledWith(1, 7, "2024-06-02");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a silence notice once a day", async () => {
    async function* silent() {
      yield { type: "silence", notice: "这次先不回了。" };
      yield { type: "done", messageId: 1, graduationSuggested: false };
    }
    runConversation.mockImplementation(() => silent());
    claimSilenceNotice.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "在吗",
      channel: "feishu",
      locale: "zh",
    });
    expect(first?.parts).toEqual(["这次先不回了。"]);

    const second = await handleChannelChat({
      userId: 1,
      conversationKey: "oc_abc",
      personaId: 7,
      messageText: "还在吗",
      channel: "feishu",
      locale: "zh",
    });
    expect(second).toBeNull();
  });
});

describe("sending channel parts", () => {
  it("waits the gap between bubbles", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const done = sendChannelParts(
      { parts: ["嗯", "好", "在"], gapsMs: [600, 800] },
      send,
    );
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("嗯");
    await vi.advanceTimersByTimeAsync(599);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("好");
    await vi.advanceTimersByTimeAsync(800);
    await done;
    expect(send.mock.calls.map((call) => call[0])).toEqual(["嗯", "好", "在"]);
    vi.useRealTimers();
  });
});
