/**
 * Group chat (C9.8).
 *
 * A room holds two to five of the user's own personas. They only speak
 * after the user does, and only up to twice per message. Their words stay
 * in `group_messages`: nothing here touches `messages`, memories, the
 * mood, the intimacy or the graduation mechanism.
 *
 * The feature is off until the user turns it on (`user.updateFeatures`).
 * Every route in this group refuses when it is off — including reading a
 * room — so a stale tab cannot use a feature the person turned off.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy, type Locale } from "@shared/copy";
import { normalizeStyleProfile } from "@shared/style-profile";
import { getEffectivePresence } from "../_core/graduation";
import { sealState } from "@shared/persona-state";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { RATE_LIMITS } from "../_core/rate-limit";
import type { GroupMessage, Persona } from "../../drizzle/schema";
import {
  addGroupRoomMember,
  countGroupRoomMembers,
  createGroupMessage,
  createGroupRoom,
  deleteGroupRoom,
  getGroupRoom,
  getLastGroupMessage,
  getPersonaById,
  getPersonasByUserId,
  getUserFeatures,
  listGroupMessages,
  listGroupRoomMembers,
  listGroupRooms,
  removeGroupRoomMember,
  renameGroupRoom,
} from "../db";
import { buildCrisisResponse, detectCrisis } from "../safety/crisis";
import { composeGroupReply } from "../group/reply";
import { decideGroupTurns, mentionsPersona, type GroupMember } from "../group/turns";

const MIN_MEMBERS = 2;
const MAX_MEMBERS = 5;
const HISTORY_LIMIT = 40;
/** How many recent room lines go into one reply's context. */
const CONTEXT_LINES = 20;

async function requireGroupChat(ctx: { user: { id: number }; locale: Locale }): Promise<void> {
  const features = await getUserFeatures(ctx.user.id);
  if (!features.groupChat) {
    throw new TRPCError({ code: "FORBIDDEN", message: copy(ctx.locale, "errors.groupDisabled") });
  }
}

/** A persona the user may put in a room: owned, ready, awake and unsealed. */
function canJoinGroup(
  persona: Persona | null | undefined,
  now: Date,
  userTimeZone: string | null,
): boolean {
  if (!persona) return false;
  if (persona.analysisStatus !== "ready") return false;
  const presence = getEffectivePresence({
    personaPresence: (persona as { presence?: string | null }).presence,
    graduationStatus: (persona as { graduationStatus?: string | null }).graduationStatus,
  });
  if (presence === "asleep") return false;
  const zone = (persona as { timezone?: string | null }).timezone ?? userTimeZone;
  if (sealState(persona, now, zone) === "sealed") return false;
  return true;
}

async function requireRoom(ctx: { user: { id: number }; locale: Locale }, roomId: number) {
  const room = await getGroupRoom(roomId, ctx.user.id);
  if (!room) throw new TRPCError({ code: "NOT_FOUND", message: copy(ctx.locale, "errors.groupNotFound") });
  return room;
}

/** The personas in a room, in join order, with their rows. */
async function personasOfRoom(
  roomId: number,
  userId: number,
  now: Date,
  userTimeZone: string | null,
): Promise<Array<{ persona: Persona; memberId: number; available: boolean }>> {
  const memberRows = await listGroupRoomMembers(roomId, userId);
  const personas = await getPersonasByUserId(userId);
  const byId = new Map(personas.map((persona) => [persona.id, persona]));
  const out: Array<{ persona: Persona; memberId: number; available: boolean }> = [];
  for (const row of memberRows) {
    const persona = byId.get(row.personaId);
    if (!persona) continue;
    out.push({ persona, memberId: row.id, available: canJoinGroup(persona, now, userTimeZone) });
  }
  return out;
}

/** A message as the group page reads it. */
function messageView(message: GroupMessage, names: Map<number, string>) {
  return {
    id: message.id,
    role: message.role,
    personaId: message.personaId ?? null,
    personaName: message.personaId != null ? names.get(message.personaId) ?? null : null,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

/** The member shape the page draws. */
function memberView(
  persona: Persona,
  available: boolean,
) {
  const profile = normalizeStyleProfile(persona.styleProfile);
  return {
    personaId: persona.id,
    name: persona.name,
    avatarUrl: persona.avatarUrl ?? null,
    hasGroupData: Boolean(profile.group),
    available,
  };
}

export const groupRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await requireGroupChat(ctx);
    const now = new Date();
    const rooms = await listGroupRooms(ctx.user.id);
    const personas = await getPersonasByUserId(ctx.user.id);
    const byId = new Map(personas.map((persona) => [persona.id, persona]));
    const out = [];
    for (const room of rooms) {
      const memberRows = await listGroupRoomMembers(room.id, ctx.user.id);
      const members = memberRows
        .map((row) => byId.get(row.personaId))
        .filter((persona): persona is Persona => Boolean(persona))
        .map((persona) =>
          memberView(persona, canJoinGroup(persona, now, ctx.user.timezone ?? null)),
        );
      const last = await getLastGroupMessage(room.id, ctx.user.id);
      const names = new Map(personas.map((persona) => [persona.id, persona.name]));
      out.push({
        id: room.id,
        name: room.name,
        createdAt: room.createdAt.toISOString(),
        members,
        lastMessage: last
          ? {
              content: last.content,
              createdAt: last.createdAt.toISOString(),
              personaName: last.personaId != null ? names.get(last.personaId) ?? null : null,
            }
          : null,
      });
    }
    return { rooms: out };
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(60),
      personaIds: z.array(z.number().int().positive()).min(MIN_MEMBERS).max(MAX_MEMBERS),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireGroupChat(ctx);
      const unique = [...new Set(input.personaIds)];
      if (unique.length < MIN_MEMBERS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.groupMemberRange") });
      }
      const now = new Date();
      const personas: Persona[] = [];
      for (const personaId of unique) {
        const persona = await getPersonaById(personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (!canJoinGroup(persona, now, ctx.user.timezone ?? null)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.groupPersonaUnavailable") });
        }
        personas.push(persona);
      }
      const room = await createGroupRoom(ctx.user.id, input.name.trim());
      if (!room) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      try {
        for (const persona of personas) {
          await addGroupRoomMember(room.id, ctx.user.id, persona.id);
        }
      } catch (error) {
        // A half-made room is worse than none: the members failed, so the
        // room goes with them.
        await deleteGroupRoom(room.id, ctx.user.id).catch(() => undefined);
        throw error;
      }
      return { id: room.id };
    }),

  rename: protectedProcedure
    .input(z.object({ roomId: z.number(), name: z.string().trim().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      await requireGroupChat(ctx);
      await requireRoom(ctx, input.roomId);
      const renamed = await renameGroupRoom(input.roomId, ctx.user.id, input.name.trim());
      if (!renamed) throw new TRPCError({ code: "NOT_FOUND", message: copy(ctx.locale, "errors.groupNotFound") });
      return { success: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ roomId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireGroupChat(ctx);
      const deleted = await deleteGroupRoom(input.roomId, ctx.user.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: copy(ctx.locale, "errors.groupNotFound") });
      return { success: true as const };
    }),

  addMember: protectedProcedure
    .input(z.object({ roomId: z.number(), personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireGroupChat(ctx);
      await requireRoom(ctx, input.roomId);
      const count = await countGroupRoomMembers(input.roomId, ctx.user.id);
      if (count >= MAX_MEMBERS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.groupMemberRange") });
      }
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canJoinGroup(persona, new Date(), ctx.user.timezone ?? null)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.groupPersonaUnavailable") });
      }
      const added = await addGroupRoomMember(input.roomId, ctx.user.id, input.personaId);
      if (!added) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.groupDuplicateMember") });
      }
      return { success: true as const };
    }),

  removeMember: protectedProcedure
    .input(z.object({ roomId: z.number(), personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireGroupChat(ctx);
      await requireRoom(ctx, input.roomId);
      const count = await countGroupRoomMembers(input.roomId, ctx.user.id);
      if (count - 1 < MIN_MEMBERS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.groupMemberRange") });
      }
      const removed = await removeGroupRoomMember(input.roomId, ctx.user.id, input.personaId);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true as const };
    }),

  /**
   * The room's lines, newest page first in the cursor but oldest first in
   * the answer — a conversation reads down the screen.
   */
  history: protectedProcedure
    .input(z.object({
      roomId: z.number(),
      cursor: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await requireGroupChat(ctx);
      const room = await requireRoom(ctx, input.roomId);
      const now = new Date();
      const members = await personasOfRoom(input.roomId, ctx.user.id, now, ctx.user.timezone ?? null);
      const names = new Map(members.map((row) => [row.persona.id, row.persona.name]));
      const page = await listGroupMessages(input.roomId, ctx.user.id, {
        limit: HISTORY_LIMIT,
        beforeId: input.cursor ?? null,
      });
      const ordered = page.slice().reverse();
      const nextCursor = page.length === HISTORY_LIMIT ? page[page.length - 1]!.id : null;
      return {
        room: {
          id: room.id,
          name: room.name,
          members: members.map((row) => memberView(row.persona, row.available)),
        },
        messages: ordered.map((message) => messageView(message, names)),
        nextCursor,
      };
    }),

  /**
   * One user line, and the persona lines it draws.
   *
   * Safety first: the user's own message goes through `detectCrisis`
   * before any persona is even considered. On a hit the room answers with
   * the crisis card and nobody speaks, and no model is called.
   */
  send: protectedProcedure
    .use(rateLimit(RATE_LIMITS.llm))
    .input(z.object({ roomId: z.number(), text: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      await requireGroupChat(ctx);
      const room = await requireRoom(ctx, input.roomId);
      const now = new Date();
      const members = await personasOfRoom(input.roomId, ctx.user.id, now, ctx.user.timezone ?? null);
      if (members.length < MIN_MEMBERS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.groupMemberRange") });
      }
      const locale = ctx.locale;
      const userName = ctx.user.name || ctx.user.username;
      const text = input.text.trim();

      const memberInputs: GroupMember[] = members.map(({ persona }) => {
        const profile = normalizeStyleProfile(persona.styleProfile);
        const aliases = (persona.settings as { skin?: { alias?: unknown } } | null)?.skin?.alias;
        return {
          personaId: persona.id,
          name: persona.name,
          aliases: typeof aliases === "string" && aliases.trim() ? [aliases.trim()] : [],
          group: (profile.group as GroupMember["group"]) ?? null,
        };
      });
      const mentionedPersonaIds = memberInputs
        .filter((member) => mentionsPersona(text, member))
        .map((member) => member.personaId);

      const userMessage = await createGroupMessage({
        roomId: room.id,
        userId: ctx.user.id,
        role: "user",
        content: text,
        metadata: mentionedPersonaIds.length > 0 ? { mentions: mentionedPersonaIds } : null,
      });
      if (!userMessage) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const userView = { id: userMessage.id, content: userMessage.content, createdAt: userMessage.createdAt.toISOString() };

      const crisis = detectCrisis(text);
      if (crisis.crisis) {
        const crisisText = buildCrisisResponse(userName, locale);
        return { userMessage: userView, replies: [], crisis: { text: crisisText } };
      }

      const decisions = decideGroupTurns({
        members: memberInputs,
        userText: text,
        seed: `group:${room.id}:${userMessage.id}`,
      });
      if (decisions.length === 0) {
        return { userMessage: userView, replies: [], crisis: null };
      }

      // The room's context for this round: the last twenty lines, oldest
      // first, ending with the line just said.
      const recent = await listGroupMessages(room.id, ctx.user.id, { limit: CONTEXT_LINES });
      const context = recent.slice().reverse();
      const memberViews = members.map((row) => ({
        personaId: row.persona.id,
        name: row.persona.name,
      }));
      const byPersonaId = new Map(members.map((row) => [row.persona.id, row.persona]));
      const nameMap = new Map(members.map((row) => [row.persona.id, row.persona.name]));

      const replies: Array<{
        id: number;
        personaId: number;
        personaName: string;
        content: string;
        createdAt: string;
      }> = [];
      for (const decision of decisions) {
        const persona = byPersonaId.get(decision.personaId);
        if (!persona) continue;
        const replyText = await composeGroupReply({
          persona,
          userId: ctx.user.id,
          userName,
          members: memberViews,
          history: context,
          locale,
          now: new Date(),
          seed: `group:${room.id}:${userMessage.id}:${persona.id}`,
        }).catch((error: unknown) => {
          console.warn("[Group] A persona's line could not be written:", (error as Error).message);
          return null;
        });
        if (!replyText) continue;
        const stored = await createGroupMessage({
          roomId: room.id,
          userId: ctx.user.id,
          role: "assistant",
          personaId: persona.id,
          content: replyText,
          metadata: { replyTo: userMessage.id, mentioned: decision.mentioned, delayMs: decision.delayMs },
        });
        if (!stored) continue;
        replies.push({
          id: stored.id,
          personaId: persona.id,
          personaName: nameMap.get(persona.id) ?? persona.name,
          content: stored.content,
          createdAt: stored.createdAt.toISOString(),
        });
      }
      return { userMessage: userView, replies, crisis: null };
    }),
});

export default groupRouter;
