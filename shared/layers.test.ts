import { describe, expect, it } from "vitest";
import {
  applyLayerOverrides,
  enabledLayerIds,
  isLayerId,
  LAYERS,
  layersFromSettings,
  USER_ONLY_LAYER_KEYS,
} from "./layers";
import { DEFAULT_PERSONA_SETTINGS } from "./persona-settings";

describe("layersFromSettings", () => {
  it("maps the renamed settings keys onto evaluation layers", () => {
    const layers = layersFromSettings({
      settings: DEFAULT_PERSONA_SETTINGS,
      rerankEnabled: false,
    });
    expect(layers.ritual).toBe(true);
    expect(layers.projection).toBe(true);
    expect(layers.seededTurns).toBe(true);
    expect(layers.twoStage).toBe(false);
    expect(layers.factRewrite).toBe(false);
    expect(layers.rerank).toBe(false);
    expect(layers.rules).toBe(true);
    expect(layers.act).toBe(true);
  });

  it("reads rerank from the existing column", () => {
    expect(layersFromSettings({ rerankEnabled: true }).rerank).toBe(true);
    expect(layersFromSettings({ rerankEnabled: false }).rerank).toBe(false);
  });

  it("does not treat user-only switches as evaluation layers", () => {
    for (const key of USER_ONLY_LAYER_KEYS) {
      expect(LAYERS).not.toContain(key);
    }
  });

  it("applies evaluation overrides without mutating the base", () => {
    const base = layersFromSettings({});
    const next = applyLayerOverrides(base, { act: false, rerank: false });
    expect(next.act).toBe(false);
    expect(base.act).toBe(true);
    expect(enabledLayerIds(next)).not.toContain("act");
  });

  it("recognises the closed set of layer ids", () => {
    expect(isLayerId("act")).toBe(true);
    expect(isLayerId("stickers")).toBe(false);
  });
});
