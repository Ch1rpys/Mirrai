/**
 * The record table, as a user manages it.
 *
 * sources lists what is in the table. deleteSource drops every row
 * from one collector platform. Deleting an uploaded file is file.delete.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  countRecords,
  countRecordsByMonth,
  deleteRecordRow,
  deleteRecordsBySource,
  getFilesByPersonaId,
  getPersonaById,
  getPersonasByUserId,
  getPersonaStyleProfile,
  getRecordReportCache,
  getRecordSourceSummary,
  getRecordsVersion,
  getRecordsAround,
  iterateRecords,
  saveRecordReportCache,
  searchRecordsLexical,
  searchRecordsSemantic,
  listMediaForRecordIds,
  listRecordMarks,
  pageRecords,
  removeRecordMark,
  upsertRecordMark,
} from "../db";
import { afterRecordsRemoved } from "../_core/style-profile";
import { renderRecordContent } from "@shared/records";
import { findHarmKind, normalizeHarmReport } from "@shared/harm";
import { findNearest } from "../records/nearest";
import { onThisDay } from "../records/on-this-day";
import { buildReport } from "../records/report";
import { buildTimeline } from "../records/timeline";
import { findFirsts, type FirstRow } from "../records/firsts";
import { collectPlaces } from "../records/places";
import { collectSongs } from "../records/songs";
import { ENV } from "../_core/env";
import type { ParseReport } from "../importers/types";

/** Reports being built in the background, so one page does not start two. */
const reportBuilds = new Set<number>();

export const recordRouter = router({
  sources: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const [summary, files] = await Promise.all([
        getRecordSourceSummary(input.personaId, ctx.user.id),
        getFilesByPersonaId(input.personaId, ctx.user.id),
      ]);
      const byId = new Map(files.map((file) => [file.id, file]));
      return summary.map((row) => {
        const file = row.fileId != null ? byId.get(row.fileId) : undefined;
        const report = (file?.parseReport as ParseReport | null) ?? null;
        return {
          source: row.source,
          fileId: row.fileId,
          name: file?.originalName ?? row.source,
          format: report?.format ?? file?.fileType ?? row.source,
          count: row.count,
          firstAt: row.firstAt?.toISOString() ?? null,
          lastAt: row.lastAt?.toISOString() ?? null,
          status: file?.parseStatus ?? "done",
        };
      });
    }),

  deleteSource: protectedProcedure
    .input(z.object({ personaId: z.number(), source: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const deletedRecords = await deleteRecordsBySource(
        input.personaId,
        ctx.user.id,
        input.source,
      );
      try {
        await afterRecordsRemoved({
          personaId: input.personaId,
          userId: ctx.user.id,
        });
      } catch (error) {
        console.warn("[Import] The rebuild flag could not be updated:", error);
      }
      return { deletedRecords };
    }),

  /**
   * One page of the reader (C2.10).
   *
   * The rows come back already rendered: the reader shows a sticker as
   * ［表情：狗狗探头］, not as the stored marker, and that rendering is
   * the same one the prompt and the export use.
   */
  page: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      anchor: z.union([
        z.object({ recordId: z.number() }),
        z.object({ at: z.string() }),
      ]).optional(),
      direction: z.enum(["older", "newer", "around"]).default("around"),
      limit: z.number().int().min(1).max(200).default(200),
    }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const anchor = input.anchor
        ? "recordId" in input.anchor
          ? { recordId: input.anchor.recordId }
          : { at: new Date(input.anchor.at) }
        : undefined;
      const page = await pageRecords(input.personaId, ctx.user.id, {
        anchor,
        direction: input.direction,
        limit: input.limit,
      });
      const ids = page.rows.map((row) => row.id);
      const [marks, mediaRows] = await Promise.all([
        listRecordMarks(input.personaId, ctx.user.id),
        listMediaForRecordIds(input.personaId, ctx.user.id, ids),
      ]);
      const marksByRecord = new Map<number, Array<{ kind: string; note: string | null }>>();
      for (const mark of marks) {
        const list = marksByRecord.get(mark.recordId) ?? [];
        list.push({ kind: mark.kind, note: mark.note });
        marksByRecord.set(mark.recordId, list);
      }
      const mediaByRecord = new Map(
        mediaRows
          .filter((row) => row.recordId != null)
          .map((row) => [row.recordId as number, row]),
      );
      const report = normalizeHarmReport(
        (persona.personaData as { harmReport?: unknown } | null)?.harmReport,
      );
      const keepHarm = report?.decision === "keep";
      return {
        rows: page.rows.map((row) => {
          const media = mediaByRecord.get(row.id);
          return {
            id: row.id,
            role: row.role,
            speaker: row.speaker,
            kind: row.kind,
            timestamp: (row.timestamp ?? row.createdAt).toISOString(),
            content: renderRecordContent(
              {
                kind: row.kind,
                content: row.content,
                meta: (row.meta ?? null) as Record<string, unknown> | null,
              },
              ctx.locale,
            ),
            source: row.source,
            fileId: row.fileId,
            meta: row.meta ?? null,
            media: media
              ? {
                  url: `/uploads/${media.fileKey}`,
                  kind: media.kind,
                  durationSec: media.durationSec,
                  transcript: media.transcript,
                }
              : null,
            /** C10.1: folded until the user opens it, unless they kept it. */
            harmful: !keepHarm && findHarmKind(row.content) != null,
            marks: marksByRecord.get(row.id) ?? [],
          };
        }),
        hasOlder: page.hasOlder,
        hasNewer: page.hasNewer,
      };
    }),

  /**
   * C2.2: the original lines, and the ones that mean something similar.
   *
   * `exact` is the literal search over the record index. `similar` is
   * null when the local embedding model is unavailable — a different
   * answer from "nothing similar", and the reader says which.
   */
  search: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      q: z.string().min(1).max(200),
      role: z.enum(["assistant", "user", "all"]).default("assistant"),
      from: z.string().optional(),
      to: z.string().optional(),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const offset = Math.max(0, Number.parseInt(input.cursor ?? "0", 10) || 0);
      const exactHits = await searchRecordsLexical(input.personaId, ctx.user.id, {
        q: input.q,
        role: input.role,
        limit: 31,
        offset,
        from: input.from ? new Date(input.from) : undefined,
        to: input.to ? new Date(input.to) : undefined,
      });
      const hasMore = exactHits.length > 30;
      const exact = exactHits.slice(0, 30).map((hit) => ({
        id: hit.id,
        content: hit.content,
        timestamp: hit.timestamp?.toISOString() ?? null,
      }));
      const semantic = await searchRecordsSemantic(input.personaId, ctx.user.id, {
        q: input.q,
        role: input.role,
        k: 8,
      });
      const exactIds = new Set(exact.map((hit) => hit.id));
      const similar = semantic
        ? semantic.hits
            .filter((hit) => !exactIds.has(hit.id) && hit.content)
            .slice(0, 5)
            .map((hit) => ({
              id: hit.id,
              content: hit.content,
              timestamp: hit.timestamp?.toISOString() ?? null,
            }))
        : null;
      return {
        exact,
        similar,
        next: hasMore ? String(offset + 30) : null,
        /** True when the semantic index covers only its most recent turns. */
        semanticTruncated: semantic?.truncated ?? false,
      };
    }),

  /** The lines around one hit (C2.2). */
  context: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      recordId: z.number(),
      before: z.number().int().min(0).max(20).default(3),
      after: z.number().int().min(0).max(20).default(3),
    }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const around = await getRecordsAround(input.recordId, ctx.user.id, input.before, input.after);
      if (!around.target || around.target.personaId !== input.personaId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const render = (row: (typeof around.before)[number]) => ({
        id: row.id,
        role: row.role,
        speaker: row.speaker,
        content: renderRecordContent(
          {
            kind: row.kind,
            content: row.content,
            meta: (row.meta ?? null) as Record<string, unknown> | null,
          },
          ctx.locale,
        ),
        timestamp: (row.timestamp ?? row.createdAt).toISOString(),
      });
      return {
        target: render(around.target),
        before: around.before.map(render),
        after: around.after.map(render),
      };
    }),

  /**
   * C2.4: the relationship's numbers, cached by records version.
   *
   * A record of a hundred thousand lines is not reprocessed for every
   * page load. Above two hundred thousand lines the answer is
   * "building" and the page asks again.
   */
  /** C2.8: the places the record mentions, from locations and photo EXIF. */
  places: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const places = await collectPlaces({ personaId: input.personaId, userId: ctx.user.id });
      /**
       * The basemap is optional and off by default. The browser only
       * learns the address when the operator has set one.
       */
      return { places, tileUrl: ENV.mapTileUrl.trim() || null };
    }),

  /** C2.8: the songs shared in the record. */
  songs: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      return collectSongs({ personaId: input.personaId, userId: ctx.user.id });
    }),

  /** C2.6: the first and the last of each thing in the record. */
  firsts: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const rows: FirstRow[] = [];
      for await (const row of iterateRecords(input.personaId, ctx.user.id)) {
        rows.push({
          id: row.id,
          role: row.role,
          content: row.content,
          kind: row.kind,
          timestamp: row.timestamp,
          createdAt: row.createdAt,
          meta: row.meta,
        });
      }
      const profile = await getPersonaStyleProfile(input.personaId, ctx.user.id);
      return findFirsts(rows, { conflict: profile?.conflict ?? null }).map((item) => ({
        ...item,
        text: renderRecordContent(
          { kind: "text", content: item.text },
          ctx.locale,
        ),
      }));
    }),

  /** C2.5: the six weekly curves and the changes the user has decided on. */
  timeline: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      return buildTimeline({ personaId: input.personaId, userId: ctx.user.id });
    }),

  report: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const version = await getRecordsVersion(input.personaId, ctx.user.id);
      const cached = await getRecordReportCache(input.personaId, ctx.user.id);
      if (cached && cached.recordsVersion === version) {
        return { status: "ready" as const, report: cached.report };
      }
      const total = await countRecords(input.personaId, ctx.user.id);
      if (total > 200_000) {
        if (!reportBuilds.has(input.personaId)) {
          reportBuilds.add(input.personaId);
          void buildReport({ personaId: input.personaId, userId: ctx.user.id })
            .then((report) =>
              saveRecordReportCache({
                personaId: input.personaId,
                userId: ctx.user.id,
                recordsVersion: version,
                report,
              }),
            )
            .catch((error) => console.warn("[Report] The build failed:", error))
            .finally(() => reportBuilds.delete(input.personaId));
        }
        return { status: "building" as const };
      }
      const report = await buildReport({ personaId: input.personaId, userId: ctx.user.id });
      await saveRecordReportCache({
        personaId: input.personaId,
        userId: ctx.user.id,
        recordsVersion: version,
        report,
      });
      return { status: "ready" as const, report };
    }),

  /** C2.1: the same calendar day in the years before. */
  onThisDay: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const years = await onThisDay({
        personaId: input.personaId,
        userId: ctx.user.id,
        today: new Date(),
        timeZone: ctx.user.timezone ?? (persona as { timezone?: string | null }).timezone ?? null,
      });
      return years.map((year) => ({
        year: year.year,
        date: year.date,
        rows: year.rows.map((row) => ({
          id: row.id,
          role: row.role,
          content: renderRecordContent(
            {
              kind: row.kind,
              content: row.content,
              meta: (row.meta ?? null) as Record<string, unknown> | null,
            },
            ctx.locale,
          ),
          timestamp: row.timestamp?.toISOString() ?? null,
        })),
      }));
    }),

  /** C2.3: which of these sentences did they actually say? */
  nearest: protectedProcedure
    .input(z.object({ personaId: z.number(), text: z.string().min(1).max(2000) }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      return findNearest({
        personaId: input.personaId,
        userId: ctx.user.id,
        text: input.text,
      });
    }),

  /** Original lines across all of the user's personas, for ⌘K (C2.2). */
  searchAll: protectedProcedure
    .input(z.object({ q: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const personas = await getPersonasByUserId(ctx.user.id);
      const out: Array<{
        personaId: number;
        personaName: string;
        recordId: number;
        content: string;
        timestamp: string | null;
      }> = [];
      for (const persona of personas) {
        if (out.length >= 20) break;
        const hits = await searchRecordsLexical(persona.id, ctx.user.id, {
          q: input.q,
          limit: Math.min(5, 20 - out.length),
        });
        for (const hit of hits) {
          out.push({
            personaId: persona.id,
            personaName: persona.name,
            recordId: hit.id,
            content: hit.content,
            timestamp: hit.timestamp?.toISOString() ?? null,
          });
        }
      }
      return out;
    }),

  /** The chapter list of the reader: months with counts, and the periods. */
  outline: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const months = await countRecordsByMonth(
        input.personaId,
        ctx.user.id,
        ctx.user.timezone,
      );
      const periods = (((persona.personaData as { periods?: unknown } | null)?.periods ?? []) as Array<{
        id?: string;
        label?: string;
        from?: string;
        to?: string;
      }>).map((period) => ({
        id: period.id ?? "",
        label: period.label ?? null,
        from: period.from ?? null,
        to: period.to ?? null,
      }));
      return { months, periods };
    }),

  marks: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const marks = await listRecordMarks(input.personaId, ctx.user.id);
        return marks.map((mark) => ({
          id: mark.id,
          recordId: mark.recordId,
          kind: mark.kind,
          note: mark.note,
          createdAt: mark.createdAt.toISOString(),
          content:
            mark.content == null
              ? null
              : renderRecordContent(
                  { kind: "text", content: mark.content },
                  ctx.locale,
                ),
          timestamp: mark.timestamp?.toISOString() ?? null,
        }));
      }),

    add: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        recordId: z.number(),
        kind: z.enum(["bookmark", "note"]),
        note: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const mark = await upsertRecordMark({
          userId: ctx.user.id,
          personaId: input.personaId,
          recordId: input.recordId,
          kind: input.kind,
          note: input.kind === "note" ? input.note ?? "" : null,
        });
        if (!mark) throw new TRPCError({ code: "NOT_FOUND" });
        return mark;
      }),

    remove: protectedProcedure
      .input(z.object({ personaId: z.number(), id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const removed = await removeRecordMark(input.id, ctx.user.id, input.personaId);
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        return { removed: true };
      }),
  }),

  /** Removes one line from the record. */
  delete: protectedProcedure
    .input(z.object({ personaId: z.number(), recordId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const deleted = await deleteRecordRow(input.recordId, input.personaId, ctx.user.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        await afterRecordsRemoved({ personaId: input.personaId, userId: ctx.user.id });
      } catch (error) {
        console.warn("[Record] The rebuild flag could not be updated:", error);
      }
      return { deleted: true };
    }),
});
