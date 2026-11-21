import { describe, expect, it } from "vitest";
import {
  LOCK_IDLE_MINUTES_DEFAULT,
  LOCK_MAX_PASSKEYS,
  isValidLockPin,
  normalizeLockSettings,
} from "./lock";

/**
 * The app lock's settings (C8.4).
 *
 * The normalizer is the only thing that stands between a hand-edited
 * JSON column and the guard, so every rule it applies is checked here:
 * an empty value is "off", an out-of-range window is clamped, and a
 * half-written passkey is dropped rather than kept as something that
 * could never verify.
 */
describe("normalizeLockSettings", () => {
  it("reads an empty value as the lock off, five minutes, no passkeys", () => {
    expect(normalizeLockSettings(null)).toEqual({
      enabled: false,
      idleMinutes: LOCK_IDLE_MINUTES_DEFAULT,
      passkeys: [],
    });
    expect(normalizeLockSettings({})).toEqual({
      enabled: false,
      idleMinutes: 5,
      passkeys: [],
    });
  });

  it("clamps the idle window to one through sixty minutes", () => {
    expect(normalizeLockSettings({ idleMinutes: 0 }).idleMinutes).toBe(1);
    expect(normalizeLockSettings({ idleMinutes: 999 }).idleMinutes).toBe(60);
    expect(normalizeLockSettings({ idleMinutes: 2.6 }).idleMinutes).toBe(3);
    expect(normalizeLockSettings({ idleMinutes: "12" }).idleMinutes).toBe(5);
  });

  it("only reads a literal true as on", () => {
    expect(normalizeLockSettings({ enabled: true }).enabled).toBe(true);
    expect(normalizeLockSettings({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeLockSettings({ enabled: 1 }).enabled).toBe(false);
  });

  it("drops a half-written passkey and keeps the good ones", () => {
    const settings = normalizeLockSettings({
      enabled: true,
      passkeys: [
        { id: "good", publicKey: "AQID", counter: 4, transports: ["internal"], label: "Mac" },
        { id: "no-key" },
        { publicKey: "no-id" },
        { id: "good", publicKey: "duplicate" },
        { id: "negative", publicKey: "AQID", counter: -5 },
      ],
    });
    expect(settings.passkeys).toHaveLength(2);
    expect(settings.passkeys[0]).toEqual({
      id: "good",
      publicKey: "AQID",
      counter: 4,
      transports: ["internal"],
      label: "Mac",
    });
    expect(settings.passkeys[1]?.counter).toBe(0);
  });

  it("keeps at most ten passkeys", () => {
    const passkeys = Array.from({ length: 14 }, (_, index) => ({
      id: `key-${index}`,
      publicKey: "AQID",
    }));
    expect(normalizeLockSettings({ passkeys }).passkeys).toHaveLength(LOCK_MAX_PASSKEYS);
  });
});

describe("isValidLockPin", () => {
  it("takes four to eight digits", () => {
    expect(isValidLockPin("1234")).toBe(true);
    expect(isValidLockPin("12345678")).toBe(true);
    expect(isValidLockPin("123")).toBe(false);
    expect(isValidLockPin("123456789")).toBe(false);
    expect(isValidLockPin("12a4")).toBe(false);
    expect(isValidLockPin("123 4")).toBe(false);
    expect(isValidLockPin(1234)).toBe(false);
    expect(isValidLockPin("")).toBe(false);
  });
});
