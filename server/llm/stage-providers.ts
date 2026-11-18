/**
 * Planner and voice providers for two-stage generation.
 *
 * Chat and evaluation have to resolve the same names, or the ruler
 * would measure a different pair of models than the conversation uses.
 */
import type { LLMProvider } from "./types";
import { resolveProviderForUser } from "./user-provider";

export async function resolveStageProviders(params: {
  userId: number;
  fallback: LLMProvider;
  personaProviderName?: string;
  settings: { providers?: { planner?: string; voice?: string } };
}): Promise<{ planner: LLMProvider; voice: LLMProvider }> {
  const plannerName = params.settings.providers?.planner || params.personaProviderName;
  const voiceName = params.settings.providers?.voice || params.personaProviderName;
  const planner =
    plannerName && plannerName !== params.personaProviderName
      ? (await resolveProviderForUser({ userId: params.userId, providerName: plannerName })) ??
        params.fallback
      : params.fallback;
  const voice =
    voiceName && voiceName !== params.personaProviderName
      ? (await resolveProviderForUser({ userId: params.userId, providerName: voiceName })) ??
        params.fallback
      : params.fallback;
  return { planner, voice };
}
