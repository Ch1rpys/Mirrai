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

  it("clamps sampling.temperature to 2", () => {
    expect(normalizePersonaSettings({ sampling: { temperature: 5 } }).sampling?.temperature).toBe(2);
    expect(normalizePersonaSettings({ sampling: { temperature: -1 } }).sampling?.temperature).toBe(0);
    expect(normalizePersonaSettings({ sampling: { topP: 1.4 } }).sampling?.topP).toBe(1);
    expect(normalizePersonaSettings({ sampling: { presencePenalty: -9 } }).sampling?.presencePenalty).toBe(-2);
  });

  it("clears sampling when the patch sets it to null", () => {
    const current = normalizePersonaSettings({ sampling: { temperature: 0.4, topP: 0.9 } });
    expect(mergePersonaSettings(current, { sampling: null }).sampling).toBeUndefined();
  });

  it("keeps a positive pending-redistill count and drops zero", () => {
    expect(normalizePersonaSettings({ pendingRedistillAdded: 12 }).pendingRedistillAdded).toBe(12);
    expect(normalizePersonaSettings({ pendingRedistillAdded: 0 }).pendingRedistillAdded).toBeUndefined();
  });

  it("keeps a pending-removed flag and drops false", () => {
    expect(normalizePersonaSettings({ pendingRedistillRemoved: true }).pendingRedistillRemoved).toBe(true);
    expect(normalizePersonaSettings({ pendingRedistillRemoved: false }).pendingRedistillRemoved).toBeUndefined();
  });

  it("asks about the reunion after graduation unless the user turned it off", () => {
    expect(normalizePersonaSettings({}).revisit).toBe(true);
    expect(normalizePersonaSettings({ revisit: false }).revisit).toBe(false);
  });

  it("turns sleep and follow-up off when late replies are turned off", () => {
    const current = normalizePersonaSettings({
      timing: { asyncDelivery: true, sleep: true, followUp: true },
    });
    const merged = mergePersonaSettings(current, { timing: { asyncDelivery: false } });
    expect(merged.timing.asyncDelivery).toBe(false);
    expect(merged.timing.sleep).toBe(false);
    expect(merged.timing.followUp).toBe(false);
    expect(normalizePersonaSettings({
      timing: { asyncDelivery: true, sleep: true, followUp: true },
    }).timing).toMatchObject({ sleep: true, followUp: true });
  });

  it("keeps a kept quote whose record is gone, for an imported bundle (C9.5)", () => {
    // A bundle without records cannot carry record ids, so the import
    // writes `recordId: null`. The words are still the words the person
    // chose; dropping the whole quote because the id is not a number
    // made them disappear from the farewell page after a restore.
    const settings = normalizePersonaSettings({
      keptQuotes: [
        { recordId: null, text: "晚安呀", at: "2024-05-01T21:00:00.000Z" },
        { recordId: 12, text: "树树 我在" },
      ],
    });
    expect(settings.keptQuotes).toEqual([
      { recordId: null, text: "晚安呀", at: "2024-05-01T21:00:00.000Z" },
      { recordId: 12, text: "树树 我在" },
    ]);
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
