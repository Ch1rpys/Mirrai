import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONA_SETTINGS,
  mergePersonaSettings,
  normalizePersonaSettings,
} from "./persona-settings";

describe("persona settings", () => {
  it("fills every default from an empty value", () => {
    expect(normalizePersonaSettings(null)).toEqual(DEFAULT_PERSONA_SETTINGS);
    expect(normalizePersonaSettings(undefined)).toEqual(DEFAULT_PERSONA_SETTINGS);
    expect(normalizePersonaSettings({})).toEqual(DEFAULT_PERSONA_SETTINGS);
  });

  it("falls a non-boolean layer back to its default", () => {
    const settings = normalizePersonaSettings({ layers: { twoStage: "yes" } });
    expect(settings.layers.twoStage).toBe(false);
    expect(settings.layers.seededTurns).toBe(true);
  });

  it("drops unknown keys", () => {
    const settings = normalizePersonaSettings({
      extra: true,
      layers: { seededTurns: false, mystery: true },
    });
    expect(settings).not.toHaveProperty("extra");
    expect(settings.layers).not.toHaveProperty("mystery");
    expect(settings.layers.seededTurns).toBe(false);
  });

  it("clamps maxDelayMinutes to 360", () => {
    expect(normalizePersonaSettings({ timing: { maxDelayMinutes: 9999 } }).timing.maxDelayMinutes).toBe(360);
    expect(normalizePersonaSettings({ timing: { maxDelayMinutes: 0 } }).timing.maxDelayMinutes).toBe(1);
    expect(normalizePersonaSettings({ timing: { maxDelayMinutes: 12 } }).timing.maxDelayMinutes).toBe(12);
  });

  it("keeps a positive pending-redistill count and drops zero", () => {
    expect(normalizePersonaSettings({ pendingRedistillAdded: 12 }).pendingRedistillAdded).toBe(12);
    expect(normalizePersonaSettings({ pendingRedistillAdded: 0 }).pendingRedistillAdded).toBeUndefined();
  });

  it("keeps a pending-removed flag and drops false", () => {
    expect(normalizePersonaSettings({ pendingRedistillRemoved: true }).pendingRedistillRemoved).toBe(true);
    expect(normalizePersonaSettings({ pendingRedistillRemoved: false }).pendingRedistillRemoved).toBeUndefined();
  });

  it("deep-merges without dropping fields the patch did not mention", () => {
    const current = normalizePersonaSettings({
      layers: { twoStage: true, stickers: false },
      timing: { asyncDelivery: true, maxDelayMinutes: 15 },
    });
    const merged = mergePersonaSettings(current, {
      layers: { voiceNotes: true },
      timing: { recall: true },
    });
    expect(merged.layers.twoStage).toBe(true);
    expect(merged.layers.stickers).toBe(false);
    expect(merged.layers.voiceNotes).toBe(true);
    expect(merged.layers.seededTurns).toBe(true);
    expect(merged.timing.asyncDelivery).toBe(true);
    expect(merged.timing.maxDelayMinutes).toBe(15);
    expect(merged.timing.recall).toBe(true);
    expect(merged.timing.typing).toBe(true);
  });
});
