/**
 * Token biases for the words a person never uses (B9.3).
 *
 * A prompt can say "they never use 呢" and the model will still produce it
 * now and then; a description of an absence is easy to ignore. A token
 * bias is not a description — it is part of the sampler. But it is only
 * honest where two things hold:
 *
 * - **The absence is measured.** The words come from the fingerprint's
 *   `never` list (a thousand lines, candidate nowhere) plus the
 *   subtractions the user confirmed. Nothing is inferred from a hunch.
 * - **The tokenizer is known.** A bias names token ids, and token ids are
 *   only meaningful for the tokenizer the model was trained with. An
 *   unknown model means no bias: sending another model's token ids would
 *   bend the reply toward a random character.
 *
 * Only strings that encode to exactly one token are used. Banning one
 * token of a two-token word would also change every other word that
 * shares that token, so a multi-token word is skipped instead.
 */
import { encodingForModel, type TiktokenModel } from "js-tiktoken";
import { effectiveStyleProfile } from "@shared/style-profile";
import { activeSuppressions, normalizeSuppressions } from "@shared/suppressions";

/** OpenAI's floor. -100 forbids the token outright. */
export const LOGIT_BIAS_VALUE = -100;
/** OpenAI's own cap on the number of entries. */
export const LOGIT_BIAS_MAX_ITEMS = 40;

export interface LogitBiasInput {
  /** The model name the request will be sent to. */
  model?: string | null;
  /** The words this person never uses. */
  banned: readonly string[];
}

/**
 * The `logit_bias` object for a request, or `{}` when none applies.
 *
 * A key is a token id as a string, because that is what the OpenAI wire
 * format calls for. Duplicate words that map to the same token collapse
 * into one entry.
 */
export function buildLogitBias(input: LogitBiasInput): Record<string, number> {
  const model = String(input.model ?? "").trim();
  if (!model) return {};
  let encode: (text: string) => number[];
  try {
    const encoder = encodingForModel(model as TiktokenModel);
    encode = (text: string) => encoder.encode(text);
  } catch {
    // Not a model whose tokenizer this package knows. A bias built on a
    // guessed tokenizer would be worse than none.
    return {};
  }
  const out: Record<string, number> = {};
  for (const candidate of input.banned) {
    const word = String(candidate ?? "").trim();
    if (!word) continue;
    let tokens: number[];
    try {
      tokens = encode(word);
    } catch {
      continue;
    }
    if (tokens.length !== 1) continue;
    out[String(tokens[0])] = LOGIT_BIAS_VALUE;
    if (Object.keys(out).length >= LOGIT_BIAS_MAX_ITEMS) break;
  }
  return out;
}

export interface PersonaForBans {
  styleProfile?: unknown;
  settings?: unknown;
  personaData?: unknown;
}

/**
 * The words this persona should not say, from what was measured and what
 * the user confirmed.
 *
 * The measured half is the fingerprint's `never` (only present with a
 * thousand lines behind it). The confirmed half is the `no_phrase`
 * subtractions — "they never say this" — which the user has accepted;
 * unconfirmed candidates stay in the editor and do not become a bias.
 */
export function bannedWordsForPersona(persona: PersonaForBans): string[] {
  const profile = effectiveStyleProfile(persona);
  const measured = Array.isArray(profile.fingerprint?.never)
    ? profile.fingerprint.never.filter((word): word is string => typeof word === "string")
    : [];
  const personaData = persona.personaData;
  const rules = normalizeSuppressions(
    personaData && typeof personaData === "object"
      ? (personaData as { suppressions?: unknown }).suppressions
      : null,
  );
  const confirmed = activeSuppressions(rules)
    .filter((rule) => rule.kind === "no_phrase" && rule.pattern.trim())
    .map((rule) => rule.pattern.trim());
  return [...new Set([...measured, ...confirmed])];
}

/** Who the provider is as far as these two request fields are concerned. */
export interface ProviderDescriptor {
  providerName?: string | null;
  /** The address this provider instance talks to, when it talks HTTP. */
  baseUrl?: string | null;
}

/** OpenAI's official endpoint, the one place `logit_bias` is known to work. */
const OFFICIAL_OPENAI_HOST = "api.openai.com";

export function isOfficialOpenAiEndpoint(provider: ProviderDescriptor): boolean {
  const name = String(provider.providerName ?? "").trim().toLowerCase();
  if (name !== "openai") return false;
  const baseUrl = String(provider.baseUrl ?? "").trim();
  // No address means the provider's own default, which is the official one.
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname.toLowerCase() === OFFICIAL_OPENAI_HOST;
  } catch {
    return false;
  }
}

function declaredFlag(extraConfig: unknown, key: string): boolean | undefined {
  if (!extraConfig || typeof extraConfig !== "object" || Array.isArray(extraConfig)) {
    return undefined;
  }
  const value = (extraConfig as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Whether the request may carry `logit_bias`.
 *
 * The user's configuration decides when it says so. Otherwise the default
 * is "only the official OpenAI address", because a bias names OpenAI's
 * token ids: an OpenAI-compatible gateway may serve a different
 * tokenizer, and another vendor's server certainly does.
 */
export function providerSupportsLogitBias(
  provider: ProviderDescriptor & { extraConfig?: unknown },
): boolean {
  const declared = declaredFlag(provider.extraConfig, "supportsLogitBias");
  if (declared !== undefined) return declared;
  return isOfficialOpenAiEndpoint(provider);
}

/**
 * Whether the request may carry a `grammar`.
 *
 * No registered provider speaks llama.cpp out of the box — a person who
 * runs one points an OpenAI-compatible row at it and turns this on. So
 * there is no default: it is off until the user says otherwise.
 */
export function providerSupportsGrammar(
  provider: ProviderDescriptor & { extraConfig?: unknown },
): boolean {
  return declaredFlag(provider.extraConfig, "supportsGrammar") === true;
}
