/**
 * The closed set of generation layers.
 *
 * Evaluation can turn each of these off one at a time. The user's
 * switches live in `personas.settings.layers`; some layers have no
 * switch and are on whenever the data is there.
 */
import {
  normalizePersonaSettings,
  type PersonaSettings,
} from "./persona-settings";

export const LAYERS = [
  "rules",
  "imperfection",
  "suppressions",
  "act",
  "exemplars",
  "seededTurns",
  "ritual",
  "styleReminder",
  "projection",
  "lengthCap",
  "actClusters",
  "people",
  "lexicon",
  "emotionInertia",
  "closing",
  "twoStage",
  "factRewrite",
  "rerank",
  "fingerprintRerank",
  "logitBias",
] as const;

export type LayerId = (typeof LAYERS)[number];

export function isLayerId(value: string): value is LayerId {
  return (LAYERS as readonly string[]).includes(value);
}

/** Settings keys that are not evaluation layers. */
export const USER_ONLY_LAYER_KEYS = [
  "stickers",
  "voiceNotes",
  "photos",
  "tools",
  "callMode",
  "abPairs",
  "factAnnotate",
] as const;

const SETTINGS_TO_LAYER: Partial<Record<keyof PersonaSettings["layers"], LayerId>> = {
  seededTurns: "seededTurns",
  ritualTable: "ritual",
  styleReminder: "styleReminder",
  styleProjection: "projection",
  lengthCap: "lengthCap",
  actClusters: "actClusters",
  emotionInertia: "emotionInertia",
  closing: "closing",
  twoStage: "twoStage",
  factRewrite: "factRewrite",
};

/**
 * Which layers are on for this persona, before evaluation overrides.
 *
 * Layers with a settings switch take that value. Layers without one
 * default on: the prompt builder still no-ops when the data is missing.
 * Rerank follows the existing column, not a settings key.
 */
export function layersFromSettings(persona: {
  settings?: unknown;
  rerankEnabled?: boolean | null;
}): Record<LayerId, boolean> {
  const settings = normalizePersonaSettings(persona.settings);
  const enabled = {} as Record<LayerId, boolean>;
  for (const id of LAYERS) enabled[id] = true;
  for (const [setting, layer] of Object.entries(SETTINGS_TO_LAYER) as Array<
    [keyof PersonaSettings["layers"], LayerId]
  >) {
    enabled[layer] = settings.layers[setting] as boolean;
  }
  enabled.rerank = Boolean(persona.rerankEnabled);
  return enabled;
}

export function applyLayerOverrides(
  base: Record<LayerId, boolean>,
  overrides?: Partial<Record<LayerId, boolean>>,
): Record<LayerId, boolean> {
  if (!overrides) return { ...base };
  return { ...base, ...overrides };
}

export function enabledLayerIds(layers: Record<LayerId, boolean>): LayerId[] {
  return LAYERS.filter((id) => layers[id]);
}

/**
 * Layers the generator actually runs.
 *
 * A switch can be on before its code exists. Ablation only spends a run
 * on a layer that can change the reply. Rerank follows the persona's
 * column: an evaluation override may turn the mechanism on for one run,
 * but that does not make it one of this persona's layers.
 */
export const BUILT_LAYERS = [
  "rules",
  "imperfection",
  "suppressions",
  "act",
  "exemplars",
  "factRewrite",
  "rerank",
] as const satisfies readonly LayerId[];

export function layersInEffect(
  layers: Record<LayerId, boolean>,
  persona?: { rerankEnabled?: boolean | null },
): LayerId[] {
  return BUILT_LAYERS.filter((id) => {
    if (!layers[id]) return false;
    if (id === "rerank" && persona && !persona.rerankEnabled) return false;
    return true;
  });
}
