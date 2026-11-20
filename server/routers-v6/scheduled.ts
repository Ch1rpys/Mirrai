/**
 * Things that arrive later (C5.3).
 *
 * A capsule is written to the user's own future self and cannot be
 * opened before the day. A message is a line to the persona that enters
 * the conversation on the day. A letter is a letter, delivered on the
 * day, and answered through the normal letter flow.
 *
 * Every route is scoped to the owner. A capsule's body is not in the
 * list before its day, and `open` refuses before then too.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { protectedProcedure, router } from "../_core/trpc";
import {
  cancelScheduledItem,
  createSafetyEvent,
  createScheduledItem,
  getPersonaById,
  getScheduledItem,
  listScheduledItems,
} from "../db";
import { buildCrisisResponse, detectCrisis } from "../safety/crisis";

export const SCHEDULED_KINDS = ["capsule", "message", "letter"] as const;

export type ScheduledItemView = {
  id: number;
  kind: (typeof SCHEDULED_KINDS)[number];
  dueAt: string;
  state: "pending" | "ready" | "cancelled";
  reason: string | null;
  body: string | null;
};

function viewOf(
  row: {
    id: number;
    kind: string;
    dueAt: Date;
    status: string;
    cancelReason?: string | null;
    body: string;
  },
  now: Date,
): ScheduledItemView | null {
  const kind = SCHEDULED_KINDS.includes(row.kind as (typeof SCHEDULED_KINDS)[number])
    ? (row.kind as (typeof SCHEDULED_KINDS)[number])
    : null;
  if (!kind) return null;
  const due = row.dueAt instanceof Date ? row.dueAt : new Date(row.dueAt);
  const dueIso = due.toISOString();
  if (row.status === "cancelled") {
    return {
      id: row.id,
      kind,
      dueAt: dueIso,
      state: "cancelled",
      reason: row.cancelReason ?? null,
      // A capsule that was never delivered stays closed even when it was
      // called off: the rule is about the day, not about the status.
      body: kind === "capsule" ? null : row.body,
    };
  }
  if (row.status === "scheduled") {
    return {
      id: row.id,
      kind,
      dueAt: dueIso,
      state: "pending",
      reason: null,
      body: kind === "capsule" ? null : row.body,
    };
  }
  // Delivered. Only a capsule has anything left to open; a message is in
  // the conversation and a letter is in the letters.
  if (kind !== "capsule") return null;
  if (due.getTime() > now.getTime()) return null;
  return { id: row.id, kind, dueAt: dueIso, state: "ready", reason: null, body: row.body };
}

export const scheduledRouter = router({
  create: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      kind: z.enum(SCHEDULED_KINDS),
      body: z.string().trim().min(1).max(20_000),
      dueAt: z.string().datetime(),
    }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const dueAt = new Date(input.dueAt);
      if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "scheduled.pastDate") });
      }

      /**
       * The line is read at the moment it is written.
       *
       * Scheduling is still writing something. A crisis line put into a
       * capsule is the one message that would wait alone until a day
       * nobody chose; it is stopped here and answered with the support
       * resources instead.
       */
      const crisis = detectCrisis(input.body);
      if (crisis.crisis) {
        await createSafetyEvent({
          userId: ctx.user.id,
          personaId: input.personaId,
          type: "crisis",
          severity: "critical",
        }).catch((error: unknown) =>
          console.warn("[Safety] Failed to record the crisis event:", error));
        return {
          created: false as const,
          crisis: true as const,
          help: buildCrisisResponse(persona.name, ctx.locale === "en" ? "en" : "zh"),
        };
      }

      const row = await createScheduledItem({
        userId: ctx.user.id,
        personaId: input.personaId,
        kind: input.kind,
        body: input.body,
        dueAt,
        status: "scheduled",
      });
      return {
        created: true as const,
        crisis: false as const,
        item: {
          id: row.id,
          kind: input.kind,
          dueAt: row.dueAt.toISOString(),
          state: "pending" as const,
          reason: null,
          body: input.kind === "capsule" ? null : input.body,
        },
      };
    }),

  list: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const rows = await listScheduledItems(input.personaId, ctx.user.id);
      const now = new Date();
      return {
        items: rows
          .map((row) => viewOf(row, now))
          .filter((row): row is ScheduledItemView => row !== null),
      };
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const item = await getScheduledItem(input.id, ctx.user.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const cancelled = await cancelScheduledItem(input.id, ctx.user.id);
      if (!cancelled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "scheduled.alreadyDone") });
      }
      return { success: true };
    }),

  /** Opens a capsule on or after its day. Before then, there is no body. */
  open: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const item = await getScheduledItem(input.id, ctx.user.id);
      if (!item || item.kind !== "capsule") throw new TRPCError({ code: "NOT_FOUND" });
      const due = item.dueAt instanceof Date ? item.dueAt : new Date(item.dueAt);
      if (due.getTime() > Date.now()) return { body: null, dueAt: due.toISOString() };
      if (item.status === "cancelled") return { body: null, dueAt: due.toISOString() };
      return { body: item.body, dueAt: due.toISOString() };
    }),
});
