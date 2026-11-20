import { describe, expect, it } from "vitest";
import {
  isMemorial,
  mayChatNow,
  meetCountdown,
  sealState,
  taperStage,
  type PersonaStateInput,
} from "./persona-state";

const shanghai = "Asia/Shanghai";
const losAngeles = "America/Los_Angeles";

/** A persona in the given state. */
function persona(settings: Record<string, unknown> = {}): PersonaStateInput {
  return { settings };
}

describe("the persona's own state (WP13)", () => {
  it("knows a memorial persona from its settings", () => {
    expect(isMemorial(persona())).toBe(false);
    expect(isMemorial(persona({ mode: "memorial" }))).toBe(true);
    // A value it does not know is not memorial: a broken row must not
    // silently change how the app talks about someone.
    expect(isMemorial(persona({ mode: "remember" }))).toBe(false);
  });

  it("reads the taper stage, defaulting to zero", () => {
    expect(taperStage(persona())).toBe(0);
    expect(taperStage(persona({ taper: { stage: 1 } }))).toBe(1);
    expect(taperStage(persona({ taper: { stage: 3 } }))).toBe(3);
    expect(taperStage(persona({ taper: { stage: 9 } }))).toBe(0);
  });

  it("opens a persona that was never sealed", () => {
    expect(sealState(persona(), new Date("2026-03-04T12:00:00Z"))).toBe("open");
    expect(sealState(persona({ seal: { until: "2026-03-20", earlyOpen: "never" } }), new Date("2026-03-04T12:00:00Z"))).toBe("sealed");
  });

  it("opens on the sealed day in the user's own calendar", () => {
    const sealed = persona({ seal: { until: "2026-03-20", earlyOpen: "never" } });
    // 00:30 on the 20th in Shanghai is already that day there.
    expect(sealState(sealed, new Date("2026-03-19T16:30:00Z"), shanghai)).toBe("open");
    // The same instant is still the 19th in Los Angeles.
    expect(sealState(sealed, new Date("2026-03-19T16:30:00Z"), losAngeles)).toBe("sealed");
  });

  it("lets a cooling-off seal open after seventy-two hours, and not before", () => {
    const sealed = persona({
      seal: { until: "2026-04-01", earlyOpen: "cooling", requestedAt: "2026-03-01T00:00:00Z" },
    });
    expect(sealState(sealed, new Date("2026-03-03T23:59:59.999Z"))).toBe("sealed"); // 72h - 1ms
    expect(sealState(sealed, new Date("2026-03-04T00:00:00.001Z"))).toBe("open");
    const never = persona({
      seal: { until: "2026-04-01", earlyOpen: "never", requestedAt: "2026-03-01T00:00:00Z" },
    });
    expect(sealState(never, new Date("2026-03-20T00:00:00Z"))).toBe("sealed");
  });

  it("closes the chat on the taper's weekend step, and opens it on a weekend", () => {
    const weekendOnly = persona({ taper: { stage: 2 } });
    expect(mayChatNow(weekendOnly, new Date("2026-03-04T12:00:00Z"), shanghai)).toEqual({
      ok: false,
      reason: "weekend_only",
    });
    expect(mayChatNow(weekendOnly, new Date("2026-03-07T12:00:00Z"), shanghai)).toEqual({ ok: true });
    expect(mayChatNow(weekendOnly, new Date("2026-03-08T12:00:00Z"), shanghai)).toEqual({ ok: true });
  });

  it("lets today's exception through, and only today's", () => {
    const weekendOnly = persona({ taper: { stage: 2, overrideDay: "2026-03-04" } });
    expect(mayChatNow(weekendOnly, new Date("2026-03-04T12:00:00Z"), shanghai)).toEqual({ ok: true });
    expect(mayChatNow(weekendOnly, new Date("2026-03-05T12:00:00Z"), shanghai)).toEqual({
      ok: false,
      reason: "weekend_only",
    });
  });

  it("reads the weekend on the user's clock, not the server's", () => {
    const weekendOnly = persona({ taper: { stage: 2 } });
    // 2026-03-07 00:30 in Shanghai is still Friday the 6th in UTC.
    expect(mayChatNow(weekendOnly, new Date("2026-03-06T16:30:00Z"), shanghai)).toEqual({ ok: true });
    expect(mayChatNow(weekendOnly, new Date("2026-03-06T16:30:00Z"), "UTC")).toEqual({
      ok: false,
      reason: "weekend_only",
    });
  });

  it("closes the chat on the letters-only step and while sealed", () => {
    const lettersOnly = persona({ taper: { stage: 3 } });
    expect(mayChatNow(lettersOnly, new Date("2026-03-07T12:00:00Z"), shanghai)).toEqual({
      ok: false,
      reason: "letters_only",
    });
    const sealed = persona({
      taper: { stage: 0 },
      seal: { until: "2026-03-20", earlyOpen: "never" },
    });
    expect(mayChatNow(sealed, new Date("2026-03-04T12:00:00Z"), shanghai)).toEqual({
      ok: false,
      reason: "sealed",
    });
  });

  it("counts the days to the meeting on the user's calendar", () => {
    const meeting = persona({ ldr: { nextMeetAt: "2026-03-02", weather: false } });
    expect(meetCountdown(meeting, new Date("2026-03-01T12:00:00Z"), shanghai)).toEqual({
      state: "upcoming",
      date: "2026-03-02",
      days: 1,
    });
    // 2026-03-01T23:30Z is the 2nd in Shanghai and still the 1st in
    // Los Angeles — the same instant, one day apart on the two clocks.
    expect(meetCountdown(meeting, new Date("2026-03-01T23:30:00Z"), shanghai)).toEqual({
      state: "today",
      date: "2026-03-02",
    });
    expect(meetCountdown(meeting, new Date("2026-03-01T23:30:00Z"), losAngeles)).toEqual({
      state: "upcoming",
      date: "2026-03-02",
      days: 1,
    });
  });

  it("says the meeting has passed, and says nothing without a date", () => {
    const meeting = persona({ ldr: { nextMeetAt: "2026-03-01", weather: false } });
    expect(meetCountdown(meeting, new Date("2026-03-04T12:00:00Z"), shanghai)).toEqual({
      state: "past",
      date: "2026-03-01",
    });
    expect(meetCountdown(persona(), new Date("2026-03-04T12:00:00Z"), shanghai)).toEqual({ state: "none" });
    expect(
      meetCountdown(persona({ ldr: { nextMeetAt: "not-a-day", weather: false } }), new Date(), shanghai),
    ).toEqual({ state: "invalid", date: "not-a-day" });
  });
});
