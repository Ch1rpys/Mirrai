/**
 * One persona's line in a group room (C9.8).
 *
 * It goes through the same planner and executor as every other reply —
 * `planTurn` + `executePlan` — with two differences from a one-to-one
 * turn: the prompt carries the group instruction, and the context is the
 * room's own recent lines rather than the pair's conversation.
 *
 * Nothing here writes. The router stores the line in `group_messages`;
 * no pair message, memory, mood, intimacy or chat count is touched.
 */
import type { GroupMessage, Persona } from "../../drizzle/schema";
import { planTurn, executePlan } from "../chat/generate";
import { resolveProviderForPurpose } from "../llm/user-provider";
import { copy, type Locale } from "@shared/copy";
import { normalizeStyleProfile } from "@shared/style-profile";
import { normalizeGroupStats } from "@shared/group-stats";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { isMemorial } from "@shared/persona-state";
import { groupOverlayText } from "./turns";

/**
 * How many characters a group line is allowed to be.
 *
 * The group profile has a median line length, not a p95, so the cap is a
 * little above the median. Without a measured group profile the pair's
 * own cap (if any) stands.
 */
export function groupLengthCap(median: number | null | undefined): number | null {
  if (typeof median !== "number" || !Number.isFinite(median) || median <= 0) return null;
  return Math.max(12, Math.min(400, Math.round(median * 2.5)));
}

export interface GroupReplyMember {
  personaId: number;
  name: string;
}

export interface ComposeGroupReplyParams {
  persona: Persona;
  userId: number;
  /** The user's display name, for the lines they said. */
  userName: string;
  /** Every persona in the room, for the instruction. */
  members: GroupReplyMember[];
  /**
   * The room's recent lines, oldest first, ending with the user's line
   * just said. At most twenty.
   */
  history: GroupMessage[];
  locale: Locale;
  now: Date;
  /** Fixes the planner's sampling; the same room, line and seed match. */
  seed: string;
}

/** The name a group line was said under. */
function speakerNameOf(
  message: GroupMessage,
  params: ComposeGroupReplyParams,
): string {
  if (message.role === "user") return params.userName;
  const member = params.members.find((row) => row.personaId === message.personaId);
  return member?.name ?? copy(params.locale, "prompt.groupUnknownSpeaker");
}

/**
 * The room's lines as context for one persona.
 *
 * Its own lines are `assistant` messages; everything else — the user and
 * the other personas — is a `user` message, prefixed with the name it was
 * said under, so the model can tell several speakers apart.
 */
export function groupContextMessages(
  params: ComposeGroupReplyParams,
): Array<{ role: "user" | "assistant"; content: string }> {
  return params.history.map((message) => {
    const own = message.role === "assistant" && message.personaId === params.persona.id;
    if (own) return { role: "assistant", content: message.content };
    return {
      role: "user",
      content: copy(params.locale, "prompt.groupSpeakerLine", {
        name: speakerNameOf(message, params),
        content: message.content,
      }),
    };
  });
}

/**
 * Writes one line for one persona, or `null` when nothing answered.
 *
 * A provider that is not configured, a model that returns nothing, or a
 * planner that decides silence all come back as `null`: the room skips
 * that persona rather than failing the whole round.
 */
export async function composeGroupReply(
  params: ComposeGroupReplyParams,
): Promise<string | null> {
  const { persona, locale } = params;
  if (persona.analysisStatus !== "ready") return null;

  const provider = await resolveProviderForPurpose({
    userId: params.userId,
    purpose: "reply",
    personaProvider: (persona as { llmProvider?: string | null }).llmProvider ?? undefined,
  }).catch(() => undefined);
  if (!provider) return null;

  const profile = normalizeStyleProfile(persona.styleProfile);
  const groupStats = normalizeGroupStats(profile.group);
  const overlay = groupOverlayText({
    locale,
    members: params.members.map((row) => row.name),
    userName: params.userName,
  });
  const context = groupContextMessages(params);
  const lastUser = [...params.history].reverse().find((row) => row.role === "user");
  const sampling = normalizePersonaSettings((persona as { settings?: unknown }).settings).sampling;

  const plan = await planTurn({
    persona,
    userId: params.userId,
    userMessage: lastUser?.content ?? "",
    history: context,
    now: params.now,
    locale,
    seed: params.seed,
    providedHistoryOnly: true,
    groupOverlay: overlay,
    groupStyle: {
      // What the person writes to a room is not what they write to one
      // person; the measured public surface is the closer one when it
      // exists.
      fingerprint: profile.publicFingerprint ?? null,
      maxChars: groupLengthCap(groupStats?.lengthMedian),
    },
    /**
     * A group round calls the model at most twice. The expensive
     * optional layers (a second stage, a four-way rerank, a fact
     * rewrite) would multiply that, so they stay off here.
     */
    layerOverrides: { twoStage: false, rerank: false, factRewrite: false, fingerprintRerank: false },
  });

  let text = "";
  for await (const event of executePlan(plan, {
    persona,
    userId: params.userId,
    userMessage: lastUser?.content ?? "",
    history: context,
    now: params.now,
    locale,
    seed: params.seed,
    providedHistoryOnly: true,
    groupOverlay: overlay,
    groupStyle: {
      fingerprint: profile.publicFingerprint ?? null,
      maxChars: groupLengthCap(groupStats?.lengthMedian),
    },
  }, {
    provider,
    mode: "once",
    rerank: false,
    options: {
      temperature: sampling?.temperature,
      maxTokens: plan.maxTokens,
    },
    emitDeltas: false,
    emptyAsSilence: false,
  })) {
    if (event.type === "final") text = event.text || text;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed;
}

/** Whether this room's members include a memorial persona (for the crisis card wording). */
export function includesMemorial(members: Persona[]): boolean {
  return members.some((persona) => isMemorial(persona));
}
