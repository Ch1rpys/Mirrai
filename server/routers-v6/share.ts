/**
 * Letting family use the same persona (C7.2).
 *
 * One identity, two rows: the owner's persona holds the name, the
 * persona data, the style profile and the records; each family member
 * gets their own row, and their own conversations, mood, letters and
 * settings stay on it.
 *
 * The invitation is a one-time token. Only its SHA-256 hash is stored,
 * it is good for seven days, and accepting it creates the member's row
 * in the same transaction that marks the invitation used.
 */
import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import {
  publicProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";
import {
  acceptPersonaShare,
  createPersonaShare,
  getActiveShareForMemberPersona,
  getPersonaById,
  getPersonaShareById,
  getPersonaShareByTokenHash,
  getUserById,
  leavePersonaShare,
  listPersonaShares,
  revokePersonaShare,
} from "../db";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export const shareRouter = router({
  /** The owner creates a link. Only the hash is stored. */
  invite: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      /**
       * A member cannot invite somebody else into a persona they do not
       * own, and an owner cannot invite themselves.
       */
      if (persona.sharedFromPersonaId) {
        throw new TRPCError({ code: "FORBIDDEN", message: copy(ctx.locale, "errors.sharedReadOnly") });
      }
      const token = newToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      const id = await createPersonaShare({
        personaId: persona.id,
        ownerUserId: ctx.user.id,
        status: "invited",
        tokenHash: hashToken(token),
        expiresAt,
      });
      return {
        id,
        token,
        link: `/share/${token}`,
        expiresAt: expiresAt.toISOString(),
      };
    }),

  /** What the invited person sees before accepting. */
  preview: publicProcedure
    .input(z.object({ token: z.string().min(8).max(200) }))
    .query(async ({ ctx, input }) => {
      const share = await getPersonaShareByTokenHash(hashToken(input.token));
      if (!share || share.status !== "invited" || share.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({ code: "NOT_FOUND", message: copy(ctx.locale, "errors.shareInvalid") });
      }
      const [owner, persona] = await Promise.all([
        getUserById(share.ownerUserId),
        getPersonaById(share.personaId, share.ownerUserId),
      ]);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        ownerName: owner?.name || owner?.username || "",
        personaName: persona.name,
      };
    }),

  /** Accepting creates the member's own row. */
  accept: protectedProcedure
    .input(z.object({ token: z.string().min(8).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const accepted = await acceptPersonaShare(hashToken(input.token), ctx.user.id);
      if (!accepted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.shareInvalid") });
      }
      return { personaId: accepted.personaId };
    }),

  list: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      if (persona.sharedFromPersonaId) {
        throw new TRPCError({ code: "FORBIDDEN", message: copy(ctx.locale, "errors.sharedReadOnly") });
      }
      const rows = await listPersonaShares(persona.id, ctx.user.id);
      return rows.map((row) => ({
        id: row.id,
        status: row.status,
        memberUserId: row.memberUserId,
        memberPersonaId: row.memberPersonaId,
        createdAt: row.createdAt.toISOString(),
        acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
      }));
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const share = await getPersonaShareById(input.id, ctx.user.id);
      if (!share || share.ownerUserId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const revoked = await revokePersonaShare(share.id, ctx.user.id);
      if (!revoked) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  /** The member stops using it; their row stays. */
  leave: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const active = persona.sharedFromPersonaId
        ? await getActiveShareForMemberPersona(persona.id, ctx.user.id)
        : undefined;
      if (!active) throw new TRPCError({ code: "NOT_FOUND" });
      await leavePersonaShare(persona.id, ctx.user.id);
      return { success: true };
    }),
});

export default shareRouter;
