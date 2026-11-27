/**
 * The keepsake book (C6.3).
 *
 * Everything in it is something the user chose or confirmed: the two
 * letters, the relationship events they wrote down, the turning points
 * they confirmed, the three lines they kept, the lines they bookmarked,
 * the photos they ticked. Nothing is generated, nothing is measured and
 * no model is called.
 *
 * The share version is the same book with the names and numbers taken
 * out. It is for a browser's print-to-PDF; the photos are left out by
 * default and can be put back one at a time on the page.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { normalizePeople } from "@shared/people";
import { redactRecords } from "@shared/redact";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getOutboundLetters,
  getPersonaById,
  listMedia,
  listRecordMarks,
  getRelationshipEvents,
} from "../db";
import { normalizeStoredTurningPoints, weekStartDate } from "../records/timeline";

function photoUrl(fileKey: string): string {
  return `/uploads/${fileKey}`;
}

/** The first character and a star — the share version never carries a full name. */
export function sharedName(name: string): string {
  const first = [...String(name ?? "").trim()][0];
  return first ? `${first}*` : "";
}

function redactOne(
  text: string | null | undefined,
  names: string[],
): string {
  const value = String(text ?? "");
  if (!value) return "";
  return redactRecords(
    [{ content: value, speaker: "", role: "user" }],
    {
      phones: true,
      ids: true,
      emails: true,
      cards: true,
      addresses: true,
      names,
    },
  ).records[0]?.content ?? value;
}

export const bookRouter = router({
  get: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      share: z.boolean().default(false),
      /** The photos the user ticked; at most twenty-four go in. */
      photoIds: z.array(z.number().int()).max(24).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

      const settings = normalizePersonaSettings(persona.settings);
      const [events, marks, outbound, photoRows] = await Promise.all([
        getRelationshipEvents(input.personaId, ctx.user.id, 200),
        listRecordMarks(input.personaId, ctx.user.id),
        getOutboundLetters(input.personaId, ctx.user.id),
        listMedia(input.personaId, ctx.user.id, { kind: "photo" }),
      ]);

      const data =
        persona.personaData && typeof persona.personaData === "object"
          ? (persona.personaData as Record<string, unknown>)
          : {};
      const people = normalizePeople(data.people ?? []);
      /**
       * The names a share copy must not carry.
       *
       * These are the people the user confirmed the persona knows about,
       * plus anyone the record marks as "other" — a name the model was
       * never told is still a name in the reader's conversation.
       */
      const thirdPartyNames = [
        ...new Set(
          people
            .map((person) => person.name.trim())
            .filter(Boolean),
        ),
      ];

      /** The name cannot appear in full in a share copy. */
      const theirName = String(persona.name ?? "");
      const replaceTheirName = (text: string) => {
        if (!input.share || !theirName) return text;
        return text.split(theirName).join(sharedName(theirName));
      };
      const redact = (text: string | null | undefined) => {
        const replaced = replaceTheirName(String(text ?? ""));
        if (!input.share) return replaced;
        return replaceTheirName(redactOne(replaced, thirdPartyNames));
      };

      /**
       * The timeline.
       *
       * Events the user wrote down, and the changes they confirmed. A
       * turning point they rejected is not in the book.
       */
      const confirmedTurningPoints = normalizeStoredTurningPoints(
        data.turningPoints,
      ).filter((point) => point.status === "confirmed");
      const timeline = [
        ...events
          .filter((event) => event.happenedAt instanceof Date)
          .map((event) => ({
            id: `event:${event.id}`,
            at: event.happenedAt.toISOString(),
            title: redact(event.title),
            detail: redact(event.detail ?? ""),
          })),
        ...confirmedTurningPoints.map((point) => ({
          id: `turning:${point.id}`,
          // The stored id is an ISO week ("2023-W24"); the book shows the
          // Monday of that week, not a string that reads as a date.
          at: weekStartDate(point.id) ?? point.at,
          title: copy(ctx.locale, "book.turningPointTitle"),
          detail: redact(point.note ?? ""),
        })),
      ].sort((left, right) => left.at.localeCompare(right.at));

      const keptQuotes = (settings.keptQuotes ?? []).slice(0, 3).map((quote) => ({
        recordId: quote.recordId,
        text: redact(quote.text),
        at: quote.at ?? null,
      }));

      const bookmarks = marks
        .filter((mark) => mark.kind === "bookmark" && mark.content)
        .map((mark) => ({
          recordId: mark.recordId,
          text: redact(mark.content),
          at: mark.timestamp ? mark.timestamp.toISOString() : null,
        }));

      const theirLetter = redact(persona.farewellLetter);
      const yourLetter = redact(outbound[0]?.text ?? "");

      const allowedPhotoIds = new Set(input.photoIds ?? []);
      const chosenPhotos = photoRows
        .filter((row) => allowedPhotoIds.has(row.id))
        .slice(0, 24)
        .map((row) => ({
          id: row.id,
          url: photoUrl(row.fileKey),
          at: row.at ? row.at.toISOString() : null,
        }));

      return {
        share: input.share,
        cover: {
          name: input.share ? sharedName(theirName) : theirName,
          togetherFrom: persona.togetherFrom ?? null,
          togetherTo: persona.togetherTo ?? null,
        },
        letters: {
          theirs: theirLetter || null,
          yours: yourLetter || null,
        },
        timeline,
        keptQuotes,
        bookmarks,
        /** All the photos the page may offer, so a share copy can put one back. */
        photoOptions: photoRows.slice(0, 200).map((row) => ({
          id: row.id,
          url: photoUrl(row.fileKey),
          at: row.at ? row.at.toISOString() : null,
        })),
        photos: chosenPhotos,
      };
    }),
});

export default bookRouter;
