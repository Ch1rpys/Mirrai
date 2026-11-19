import { describe, expect, it, beforeEach } from "vitest";
import {
  arrive,
  enter,
  fallbackChannelGapMs,
  isLatest,
  leave,
  resetInbox,
  waitAbortable,
} from "./inbox";

describe("the inbox", () => {
  beforeEach(() => {
    resetInbox();
  });

  it("aborts a generating turn when a later message arrives", () => {
    const key = "1:7";
    const controller = new AbortController();
    enter(key, "generating", controller);
    const generation = arrive(key);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("superseded");
    expect(isLatest(key, generation)).toBe(true);
  });

  it("does not abort a turn that has started writing", () => {
    const key = "1:7";
    const controller = new AbortController();
    enter(key, "committing", controller);
    arrive(key);
    expect(controller.signal.aborted).toBe(false);
  });

  it("knows which generation is current", () => {
    const key = "1:7";
    const first = arrive(key);
    expect(isLatest(key, first)).toBe(true);
    expect(isLatest(key, first - 1)).toBe(false);
    const second = arrive(key);
    expect(isLatest(key, first)).toBe(false);
    expect(isLatest(key, second)).toBe(true);
  });

  it("leaves an older generation without wiping a newer one", () => {
    const key = "1:7";
    const first = arrive(key);
    const firstController = new AbortController();
    enter(key, "generating", firstController);
    const second = arrive(key);
    const secondController = new AbortController();
    enter(key, "waiting", secondController);
    leave(key, first);
    expect(isLatest(key, second)).toBe(true);
    expect(secondController.signal.aborted).toBe(false);
  });
});

describe("waiting that can be taken away", () => {
  it("rejects when the signal is aborted", async () => {
    const controller = new AbortController();
    const waiting = waitAbortable(5_000, controller.signal);
    controller.abort("superseded");
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("the gap between two channel bubbles", () => {
  it("clamps a short line to 600 ms and a long one to 8 s", () => {
    expect(fallbackChannelGapMs("嗯")).toBe(600);
    expect(fallbackChannelGapMs("a".repeat(40))).toBe(8_000);
    expect(fallbackChannelGapMs("你好呀")).toBe(750);
  });
});
