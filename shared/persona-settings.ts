/**
 * Per-persona switches and small config.
 *
 * The sixth stage puts every new persona-level knob in `personas.settings`
 * rather than adding another boolean column. Empty (or missing) means
 * every default: layers that do not cost a model call are on, layers
 * that cost money, time, or the network are off.
 */

export interface PersonaSettings {
  /** Generation layers. Ones that do not cost a model call default true. */
  layers: {
    seededTurns: boolean;
    ritualTable: boolean;
    styleReminder: boolean;
    styleProjection: boolean;
    lengthCap: boolean;
    actClusters: boolean;
    emotionInertia: boolean;
    closing: boolean;
    stickers: boolean;
    factAnnotate: boolean;
    twoStage: boolean;
    factRewrite: boolean;
    abPairs: boolean;
    tools: boolean;
    voiceNotes: boolean;
    photos: boolean;
    callMode: boolean;
  };
  /** Only takes effect when `personas.timingEnabled` is on. */
  timing: {
    typing: boolean;
    asyncDelivery: boolean;
    maxDelayMinutes: number;
    sleep: boolean;
    followUp: boolean;
    recall: boolean;
  };
  sampling?: {
    temperature?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
  };
  providers?: { planner?: string; voice?: string };
  skin?: { theme: "classic" | "im-green" | "im-blue"; alias?: string; background?: string };
  ldr?: { nextMeetAt?: string; city?: { name: string; lat: number; lng: number }; weather: boolean };
  taper?: { stage: 0 | 1 | 2 | 3; overrideDay?: string };
  seal?: { until?: string; earlyOpen: "never" | "cooling"; requestedAt?: string };
  mode?: "default" | "memorial";
  memorial?: { birthday?: string; deathday?: string };
  graduationKind?: "farewell" | "said_it" | "reconciled" | "not_afraid";
  keptQuotes?: Array<{ recordId: number; text: string; at?: string }>;
  consent?: "asked_yes" | "asked_no" | "not_asked" | "cannot_ask";
  locked?: boolean;
  unreachableSince?: string;
  lastReunion?: { from: string; to: string; dismissed?: boolean };
  onThisDay?: boolean;
  letterEmail?: boolean;
  revisit?: boolean;
  saidItHintShown?: boolean;
  consentLink?: { tokenHash: string; expiresAt: string; answeredAt?: string };
  disabledProfiles?: string[];
  /**
   * Records added after the last distillation.
   *
   * The upload page offers to rebuild when this is a positive count.
   * Missing means nothing is waiting.
   */
  pendingRedistillAdded?: number;
  /**
   * Records were removed after the last distillation.
   *
   * The upload page offers to rebuild when this is true. Missing means
   * the table still matches what the persona was built from.
   */
  pendingRedistillRemoved?: boolean;
}

const LAYER_KEYS = [
  "seededTurns",
  "ritualTable",
  "styleReminder",
  "styleProjection",
  "lengthCap",
  "actClusters",
  "emotionInertia",
  "closing",
  "stickers",
  "factAnnotate",
  "twoStage",
  "factRewrite",
  "abPairs",
  "tools",
  "voiceNotes",
  "photos",
  "callMode",
] as const;

const LAYER_DEFAULTS: PersonaSettings["layers"] = {
  seededTurns: true,
  ritualTable: true,
  styleReminder: true,
  styleProjection: true,
  lengthCap: true,
  actClusters: true,
  emotionInertia: true,
  closing: true,
  stickers: true,
  factAnnotate: true,
  twoStage: false,
  factRewrite: false,
  abPairs: false,
  tools: false,
  voiceNotes: false,
  photos: false,
  callMode: false,
};

const TIMING_BOOLS = ["typing", "asyncDelivery", "sleep", "followUp", "recall"] as const;

const TIMING_DEFAULTS: PersonaSettings["timing"] = {
  typing: true,
  asyncDelivery: false,
  maxDelayMinutes: 30,
  sleep: false,
  followUp: false,
  recall: false,
};

export const DEFAULT_PERSONA_SETTINGS: PersonaSettings = {
  layers: { ...LAYER_DEFAULTS },
  timing: { ...TIMING_DEFAULTS },
  onThisDay: true,
  letterEmail: false,
  revisit: true,
};

const SKIN_THEMES = new Set(["classic", "im-green", "im-blue"]);
const TAPER_STAGES = new Set([0, 1, 2, 3]);
const SEAL_EARLY = new Set(["never", "cooling"]);
const MODES = new Set(["default", "memorial"]);
const GRADUATION_KINDS = new Set(["farewell", "said_it", "reconciled", "not_afraid"]);
const CONSENTS = new Set(["asked_yes", "asked_no", "not_asked", "cannot_ask"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clampDelay(value: unknown): number {
  const n = asFiniteNumber(value);
  const base = n === undefined ? TIMING_DEFAULTS.maxDelayMinutes : n;
  return Math.min(360, Math.max(1, Math.round(base)));
}

function normalizeLayers(value: unknown): PersonaSettings["layers"] {
  const source = isPlainObject(value) ? value : {};
  const out = { ...LAYER_DEFAULTS };
  for (const key of LAYER_KEYS) {
    out[key] = asBoolean(source[key], LAYER_DEFAULTS[key]);
  }
  return out;
}

function normalizeTiming(value: unknown): PersonaSettings["timing"] {
  const source = isPlainObject(value) ? value : {};
  const out: PersonaSettings["timing"] = {
    typing: asBoolean(source.typing, TIMING_DEFAULTS.typing),
    asyncDelivery: asBoolean(source.asyncDelivery, TIMING_DEFAULTS.asyncDelivery),
    maxDelayMinutes: clampDelay(source.maxDelayMinutes),
    sleep: asBoolean(source.sleep, TIMING_DEFAULTS.sleep),
    followUp: asBoolean(source.followUp, TIMING_DEFAULTS.followUp),
    recall: asBoolean(source.recall, TIMING_DEFAULTS.recall),
  };
  return out;
}

function normalizeSampling(value: unknown): PersonaSettings["sampling"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const sampling: NonNullable<PersonaSettings["sampling"]> = {};
  const temperature = asFiniteNumber(value.temperature);
  const topP = asFiniteNumber(value.topP);
  const presencePenalty = asFiniteNumber(value.presencePenalty);
  const frequencyPenalty = asFiniteNumber(value.frequencyPenalty);
  if (temperature !== undefined) sampling.temperature = temperature;
  if (topP !== undefined) sampling.topP = topP;
  if (presencePenalty !== undefined) sampling.presencePenalty = presencePenalty;
  if (frequencyPenalty !== undefined) sampling.frequencyPenalty = frequencyPenalty;
  return Object.keys(sampling).length ? sampling : undefined;
}

function normalizeProviders(value: unknown): PersonaSettings["providers"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const planner = asString(value.planner);
  const voice = asString(value.voice);
  const providers: NonNullable<PersonaSettings["providers"]> = {};
  if (planner !== undefined) providers.planner = planner;
  if (voice !== undefined) providers.voice = voice;
  return Object.keys(providers).length ? providers : undefined;
}

function normalizeSkin(value: unknown): PersonaSettings["skin"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const theme = asString(value.theme);
  if (!theme || !SKIN_THEMES.has(theme)) return undefined;
  const skin: NonNullable<PersonaSettings["skin"]> = {
    theme: theme as "classic" | "im-green" | "im-blue",
  };
  const alias = asString(value.alias);
  const background = asString(value.background);
  if (alias !== undefined) skin.alias = alias;
  if (background !== undefined) skin.background = background;
  return skin;
}

function normalizeCity(value: unknown): { name: string; lat: number; lng: number } | undefined {
  if (!isPlainObject(value)) return undefined;
  const name = asString(value.name);
  const lat = asFiniteNumber(value.lat);
  const lng = asFiniteNumber(value.lng);
  if (name === undefined || lat === undefined || lng === undefined) return undefined;
  return { name, lat, lng };
}

function normalizeLdr(value: unknown): PersonaSettings["ldr"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const ldr: NonNullable<PersonaSettings["ldr"]> = {
    weather: asBoolean(value.weather, false),
  };
  const nextMeetAt = asString(value.nextMeetAt);
  if (nextMeetAt !== undefined) ldr.nextMeetAt = nextMeetAt;
  const city = normalizeCity(value.city);
  if (city) ldr.city = city;
  return ldr;
}

function normalizeTaper(value: unknown): PersonaSettings["taper"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const stage = asFiniteNumber(value.stage);
  if (stage === undefined || !TAPER_STAGES.has(stage)) return undefined;
  const taper: NonNullable<PersonaSettings["taper"]> = {
    stage: stage as 0 | 1 | 2 | 3,
  };
  const overrideDay = asString(value.overrideDay);
  if (overrideDay !== undefined) taper.overrideDay = overrideDay;
  return taper;
}

function normalizeSeal(value: unknown): PersonaSettings["seal"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const earlyOpen = asString(value.earlyOpen);
  if (!earlyOpen || !SEAL_EARLY.has(earlyOpen)) return undefined;
  const seal: NonNullable<PersonaSettings["seal"]> = {
    earlyOpen: earlyOpen as "never" | "cooling",
  };
  const until = asString(value.until);
  const requestedAt = asString(value.requestedAt);
  if (until !== undefined) seal.until = until;
  if (requestedAt !== undefined) seal.requestedAt = requestedAt;
  return seal;
}

function normalizeMemorial(value: unknown): PersonaSettings["memorial"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const memorial: NonNullable<PersonaSettings["memorial"]> = {};
  const birthday = asString(value.birthday);
  const deathday = asString(value.deathday);
  if (birthday !== undefined) memorial.birthday = birthday;
  if (deathday !== undefined) memorial.deathday = deathday;
  return Object.keys(memorial).length ? memorial : undefined;
}

function normalizeKeptQuotes(value: unknown): PersonaSettings["keptQuotes"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: NonNullable<PersonaSettings["keptQuotes"]> = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const recordId = asFiniteNumber(item.recordId);
    const text = asString(item.text);
    if (recordId === undefined || text === undefined) continue;
    const quote: { recordId: number; text: string; at?: string } = { recordId, text };
    const at = asString(item.at);
    if (at !== undefined) quote.at = at;
    out.push(quote);
  }
  return out;
}

function normalizeLastReunion(value: unknown): PersonaSettings["lastReunion"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const from = asString(value.from);
  const to = asString(value.to);
  if (from === undefined || to === undefined) return undefined;
  const lastReunion: NonNullable<PersonaSettings["lastReunion"]> = { from, to };
  if (typeof value.dismissed === "boolean") lastReunion.dismissed = value.dismissed;
  return lastReunion;
}

function normalizeConsentLink(value: unknown): PersonaSettings["consentLink"] | undefined {
  if (!isPlainObject(value)) return undefined;
  const tokenHash = asString(value.tokenHash);
  const expiresAt = asString(value.expiresAt);
  if (tokenHash === undefined || expiresAt === undefined) return undefined;
  const consentLink: NonNullable<PersonaSettings["consentLink"]> = { tokenHash, expiresAt };
  const answeredAt = asString(value.answeredAt);
  if (answeredAt !== undefined) consentLink.answeredAt = answeredAt;
  return consentLink;
}

function normalizeDisabledProfiles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function pickUnion<T extends string>(value: unknown, allowed: Set<string>): T | undefined {
  const text = asString(value);
  if (!text || !allowed.has(text)) return undefined;
  return text as T;
}

/**
 * Fills defaults, drops unknown keys, and coerces the rest.
 *
 * A value of the wrong type falls back to the default for that field.
 * `maxDelayMinutes` is clamped to 1–360.
 */
export function normalizePersonaSettings(value: unknown): PersonaSettings {
  const source = isPlainObject(value) ? value : {};
  const settings: PersonaSettings = {
    layers: normalizeLayers(source.layers),
    timing: normalizeTiming(source.timing),
    onThisDay: asBoolean(source.onThisDay, true),
    letterEmail: asBoolean(source.letterEmail, false),
    revisit: asBoolean(source.revisit, true),
  };

  const sampling = normalizeSampling(source.sampling);
  if (sampling) settings.sampling = sampling;
  const providers = normalizeProviders(source.providers);
  if (providers) settings.providers = providers;
  const skin = normalizeSkin(source.skin);
  if (skin) settings.skin = skin;
  const ldr = normalizeLdr(source.ldr);
  if (ldr) settings.ldr = ldr;
  const taper = normalizeTaper(source.taper);
  if (taper) settings.taper = taper;
  const seal = normalizeSeal(source.seal);
  if (seal) settings.seal = seal;
  const mode = pickUnion<NonNullable<PersonaSettings["mode"]>>(source.mode, MODES);
  if (mode) settings.mode = mode;
  const memorial = normalizeMemorial(source.memorial);
  if (memorial) settings.memorial = memorial;
  const graduationKind = pickUnion<NonNullable<PersonaSettings["graduationKind"]>>(
    source.graduationKind,
    GRADUATION_KINDS,
  );
  if (graduationKind) settings.graduationKind = graduationKind;
  const keptQuotes = normalizeKeptQuotes(source.keptQuotes);
  if (keptQuotes) settings.keptQuotes = keptQuotes;
  const consent = pickUnion<NonNullable<PersonaSettings["consent"]>>(source.consent, CONSENTS);
  if (consent) settings.consent = consent;
  if (typeof source.locked === "boolean") settings.locked = source.locked;
  const unreachableSince = asString(source.unreachableSince);
  if (unreachableSince !== undefined) settings.unreachableSince = unreachableSince;
  const lastReunion = normalizeLastReunion(source.lastReunion);
  if (lastReunion) settings.lastReunion = lastReunion;
  if (typeof source.saidItHintShown === "boolean") settings.saidItHintShown = source.saidItHintShown;
  const consentLink = normalizeConsentLink(source.consentLink);
  if (consentLink) settings.consentLink = consentLink;
  const disabledProfiles = normalizeDisabledProfiles(source.disabledProfiles);
  if (disabledProfiles) settings.disabledProfiles = disabledProfiles;
  const pendingRedistillAdded = asFiniteNumber(source.pendingRedistillAdded);
  if (pendingRedistillAdded !== undefined && pendingRedistillAdded > 0) {
    settings.pendingRedistillAdded = Math.round(pendingRedistillAdded);
  }
  if (source.pendingRedistillRemoved === true) {
    settings.pendingRedistillRemoved = true;
  }

  return settings;
}

function mergeObject<T extends Record<string, unknown>>(
  current: T,
  patch: unknown,
): T {
  if (!isPlainObject(patch)) return current;
  const next: Record<string, unknown> = { ...current };
  for (const key of Object.keys(current)) {
    if (!(key in patch)) continue;
    const currentValue = current[key];
    const patchValue = patch[key];
    if (isPlainObject(currentValue) && isPlainObject(patchValue)) {
      next[key] = mergeObject(currentValue, patchValue);
    } else {
      next[key] = patchValue;
    }
  }
  for (const key of Object.keys(patch)) {
    if (key in current) continue;
    next[key] = patch[key];
  }
  return next as T;
}

/**
 * Deep-merges a patch onto the current settings.
 *
 * Only keys that belong on `PersonaSettings` survive: unknown keys in
 * the patch are dropped by the normaliser afterwards. Nested objects
 * merge; arrays replace.
 */
export function mergePersonaSettings(
  current: PersonaSettings | null | undefined,
  patch: unknown,
): PersonaSettings {
  const base = normalizePersonaSettings(current);
  if (!isPlainObject(patch)) return base;
  const merged = mergeObject(base as unknown as Record<string, unknown>, patch);
  return normalizePersonaSettings(merged);
}

export const PERSONA_SETTINGS_LAYER_KEYS = LAYER_KEYS;
export const PERSONA_SETTINGS_TIMING_BOOLS = TIMING_BOOLS;
