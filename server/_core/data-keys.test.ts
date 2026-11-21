import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATA_KEY_IDLE_MS,
  dataKeyFor,
  forgetAllDataKeys,
  forgetDataKey,
  hasDataKey,
  rememberDataKey,
  unlockedDataKeyCount,
} from "./data-keys";
import { generateDataKey } from "./content-crypto";

/**
 * The unlocked keys in memory (C8.5).
 *
 * They only live here: never on disk, never in a route's answer. A key
 * that has not been used for a day is dropped, and the explicit lock or
 * password change drops it at once.
 */
describe("the data key memory", () => {
  beforeEach(() => {
    forgetAllDataKeys();
  });

  afterEach(() => {
    vi.useRealTimers();
    forgetAllDataKeys();
  });

  it("remembers a key until it is forgotten", () => {
    const key = generateDataKey();
    rememberDataKey(1, key);
    expect(hasDataKey(1)).toBe(true);
    expect(dataKeyFor(1)?.equals(key)).toBe(true);
    // Somebody else's account is not unlocked by it.
    expect(hasDataKey(2)).toBe(false);

    forgetDataKey(1);
    expect(dataKeyFor(1)).toBeNull();
    expect(unlockedDataKeyCount()).toBe(0);
  });

  it("copies the key, so a caller changing its buffer changes nothing", () => {
    const key = generateDataKey();
    rememberDataKey(3, key);
    key.fill(0);
    expect(dataKeyFor(3)?.equals(key)).toBe(false);
    expect(dataKeyFor(3)?.some((byte) => byte !== 0)).toBe(true);
  });

  it("only takes 32 bytes", () => {
    expect(() => rememberDataKey(4, Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it("drops a key nobody used for a day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T10:00:00.000Z"));
    rememberDataKey(5, generateDataKey());

    vi.setSystemTime(new Date(Date.now() + DATA_KEY_IDLE_MS - 1000));
    expect(hasDataKey(5)).toBe(true);

    // That look slid the window; a full idle period after it drops the key.
    vi.setSystemTime(new Date(Date.now() + DATA_KEY_IDLE_MS + 1000));
    expect(hasDataKey(5)).toBe(false);
    expect(unlockedDataKeyCount()).toBe(0);
  });

  it("slides the idle window when the key is used", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T10:00:00.000Z"));
    rememberDataKey(6, generateDataKey());

    vi.setSystemTime(new Date(Date.now() + DATA_KEY_IDLE_MS - 1000));
    expect(hasDataKey(6)).toBe(true);
    vi.setSystemTime(new Date(Date.now() + DATA_KEY_IDLE_MS - 1000));
    expect(hasDataKey(6)).toBe(true);
  });
});
