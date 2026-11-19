/**
 * A few real exchanges, placed in front of the live history.
 *
 * They are retrieved with the same scorer as the exemplar section, then
 * cleaned so they can sit outside the fence as ordinary turns.
 */
import { copy, type Locale } from "@shared/copy";
import { filterHarm, type HarmReport } from "@shared/harm";
import { isSafeSeedLine } from "@shared/seed-safety";
import type { Exemplar } from "./exemplars";
import type { LLMMessage } from "../llm/types";

export const SEED_MAX_EXCHANGES = 3;
export const SEED_MAX_EXCHANGE_CHARS = 120;
export const SEED_MAX_USER_BUBBLES = 3;

export interface SeedExchange {
  user: string[];
  them: string[];
  recordIds: number[];
  sceneKey: number;
  score: number;
}

function charCount(user: string[], them: string[]): number {
  let n = 0;
  for (const line of user) n += line.length;
  for (const line of them) n += line.length;
  return n;
}

export function selectSeedExchanges(params: {
  exemplars: Exemplar[];
  limit?: number;
  personaData?: { harmReport?: HarmReport | null } | null;
}): SeedExchange[] {
  const limit = params.limit ?? SEED_MAX_EXCHANGES;
  const usedScenes = new Set<number>();
  const out: SeedExchange[] = [];
  /**
   * The same decision the rest of the generation path reads.
   *
   * `keep` means the user asked to keep those lines. `pending` and
   * `remove` mean they must not be copied into a real turn; `soften`
   * keeps the voice but still filters the lines.
   */
  const allowHarm = params.personaData?.harmReport?.decision === "keep";
  for (const item of params.exemplars) {
    if (out.length >= limit) break;
    if (usedScenes.has(item.sceneKey)) continue;
    const user = (item.previousUserTurn.length > 0 ? item.previousUserTurn : [item.previousUser])
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-SEED_MAX_USER_BUBBLES);
    const them = (item.rawTurn?.length ? item.rawTurn : item.turn)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!user.length || !them.length) continue;
    if (charCount(user, them) > SEED_MAX_EXCHANGE_CHARS) continue;
    // The other person's lines are the ones the replica would learn.
    const keptThem = filterHarm(
      them.map((content) => ({ content, role: "assistant" as const })),
      params.personaData,
    );
    if (keptThem.length !== them.length) continue;
    // A user line is context. The harm filter is about what the persona
    // says; a line the user typed is not a line the replica learns.
    if (user.some((line) => !isSafeSeedLine(line, { allowHarm: true }))) continue;
    if (them.some((line) => !isSafeSeedLine(line, { allowHarm }))) continue;
    const recordIds = [
      ...(item.previousUserIds ?? []),
      ...(item.turnIds?.length ? item.turnIds : [item.id]),
    ];
    out.push({
      user,
      them,
      recordIds,
      sceneKey: item.sceneKey,
      score: item.score,
    });
    usedScenes.add(item.sceneKey);
  }
  return out;
}

export function seedMessagesFor(exchanges: SeedExchange[], locale: Locale): LLMMessage[] {
  if (!exchanges.length) return [];
  const prefix = copy(locale, "prompt.seedTurnsPrefix");
  const messages: LLMMessage[] = [];
  for (const exchange of exchanges) {
    messages.push({
      role: "user",
      content: exchange.user.map((line) => `${prefix}${line}`).join("\n"),
    });
    for (const line of exchange.them) {
      messages.push({ role: "assistant", content: line });
    }
  }
  return messages;
}

export function spliceAfterSystem(
  messages: LLMMessage[],
  extra: LLMMessage[],
): LLMMessage[] {
  if (!extra.length) return messages;
  if (messages[0]?.role !== "system") return [...extra, ...messages];
  return [messages[0], ...extra, ...messages.slice(1)];
}
