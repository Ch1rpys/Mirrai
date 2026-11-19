import { describe, expect, it, vi } from "vitest";
import { revealBurst, revealDelay } from "./useTypingReveal";

describe("useTypingReveal", () => {
  it("hides the dots for the quiet stretch, then shows them while typing, then yields the line", async () => {
    vi.useFakeTimers();
    try {
      let dots: boolean | undefined;
      let shown = false;
      const running = revealDelay({
        ms: 10_000,
        typingMs: 3_000,
        setDots: (on) => {
          dots = on;
        },
      }).then(() => {
        shown = true;
      });
      await Promise.resolve();
      expect(dots).toBe(false);
      expect(shown).toBe(false);
      await vi.advanceTimersByTimeAsync(6_999);
      expect(dots).toBe(false);
      expect(shown).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(dots).toBe(true);
      expect(shown).toBe(false);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(dots).toBe(true);
      expect(shown).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(shown).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the dots three times across a three-line burst", async () => {
    vi.useFakeTimers();
    try {
      let appearances = 0;
      const shown: string[][] = [];
      const running = revealBurst({
        texts: ["嗯", "好", "在"],
        gapsMs: [1_000, 1_000],
        typingMs: [200, 200, 200],
        setDots: (on) => {
          if (on) appearances += 1;
        },
        show: (texts) => {
          shown.push(texts);
        },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await running;
      expect(appearances).toBe(3);
      expect(shown).toEqual([["嗯"], ["嗯", "好"], ["嗯", "好", "在"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not change any state after the turn is aborted", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const log: string[] = [];
      const running = revealDelay({
        ms: 10_000,
        typingMs: 3_000,
        signal: controller.signal,
        setDots: (on) => {
          log.push(on ? "on" : "off");
        },
      });
      await Promise.resolve();
      expect(log).toEqual(["off"]);
      controller.abort();
      await vi.advanceTimersByTimeAsync(10_000);
      await running;
      expect(log).toEqual(["off"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
