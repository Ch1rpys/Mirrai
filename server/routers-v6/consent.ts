/**
 * The consent tool (C10.3).
 *
 * The person a persona was rebuilt from can be asked. The owner can send
 * a self-contained page, or a link on this instance that the other
 * person can open without an account. They can say yes, they can say no,
 * and no is enforced: the chat closes, and the only thing left on screen
 * is a way to delete everything for good.
 *
 * A token is 32 random bytes; only its hash is stored. An invalid, an
 * expired and an already-answered link all answer with the same 404, so
 * the page cannot be used to tell a real token from a used one.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { mergePersonaSettings, normalizePersonaSettings } from "@shared/persona-settings";
import { protectedProcedure, publicProcedure, router, rateLimit } from "../_core/trpc";
import { RATE_LIMITS } from "../_core/rate-limit";
import { withPersonaDataLock } from "../_core/lock";
import {
  findPersonaByConsentTokenHash,
  getPersonaById,
  getPersonaSettings,
  setPersonaSettings,
} from "../db";
import {
  buildConsentPageHtml,
  CONSENT_LINK_TTL_MS,
  createConsentToken,
  hashConsentToken,
  isConsentLinkExpired,
} from "../consent/link";

const consentStatusSchema = z.enum(["not_asked", "asked_yes", "asked_no", "cannot_ask"]);
const consentAnswerSchema = z.enum(["yes", "no"]);

/** What the owner's profile page shows, and nothing more. */
function publicLinkOf(settings: unknown): { expiresAt: string; answeredAt?: string } | null {
  const normalized = normalizePersonaSettings(settings);
  const link = normalized.consentLink;
  if (!link) return null;
  return {
    expiresAt: link.expiresAt,
    ...(link.answeredAt ? { answeredAt: link.answeredAt } : {}),
  };
}

/** The one answer every unusable token gets. */
function invalidLink(): TRPCError {
  return new TRPCError({
    code: "NOT_FOUND",
    message: copy("zh", "errors.consentLinkInvalid"),
  });
}

export const consentRouter = router({
  /** The owner's view: where the asking stands. */
  status: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const settings = normalizePersonaSettings(
        (await getPersonaSettings(input.personaId, ctx.user.id)) ?? persona.settings,
      );
      return {
        consent: settings.consent ?? "not_asked",
        link: publicLinkOf(settings),
      };
    }),

  /**
   * The owner records what the other person said, or that they cannot be
   * asked. Asked-no closes the chat immediately — `mayChatNow` reads the
   * same setting.
   */
  setStatus: protectedProcedure
    .input(z.object({ personaId: z.number(), consent: consentStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      return await withPersonaDataLock(input.personaId, async () => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const current = await getPersonaSettings(input.personaId, ctx.user.id);
        const next = mergePersonaSettings(current, { consent: input.consent });
        const written = await setPersonaSettings(input.personaId, ctx.user.id, next);
        if (!written) throw new TRPCError({ code: "NOT_FOUND" });
        return { consent: next.consent ?? "not_asked" };
      });
    }),

  /** The self-contained page the owner can send. */
  exportPage: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      return { html: buildConsentPageHtml({ name: persona.name, locale: ctx.locale }) };
    }),

  /**
   * A link on this instance.
   *
   * The hash is stored, the token is returned once. Making a new link
   * replaces the old one, so an earlier link stops working — which is
   * what a person who sent one to the wrong place would expect.
   */
  createLink: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return await withPersonaDataLock(input.personaId, async () => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const token = createConsentToken();
        const expiresAt = new Date(Date.now() + CONSENT_LINK_TTL_MS).toISOString();
        const current = await getPersonaSettings(input.personaId, ctx.user.id);
        const next = mergePersonaSettings(current, {
          consentLink: { tokenHash: hashConsentToken(token), expiresAt },
        });
        /**
         * A new link starts unanswered (C10.6 acceptance finding).
         *
         * The merge is deep, so a link that had already been answered
         * kept its `answeredAt` when it was replaced — and the new link
         * was refused by `getByToken` before it could be opened. The
         * owner re-asks with a fresh question, so the fresh link carries
         * only its own hash and expiry.
         */
        if (next.consentLink) delete next.consentLink.answeredAt;
        const written = await setPersonaSettings(input.personaId, ctx.user.id, next);
        if (!written) throw new TRPCError({ code: "NOT_FOUND" });
        return { path: `/consent/${token}`, expiresAt };
      });
    }),

  /**
   * The public page's only read.
   *
   * The reply is the modelled person's name and nothing else — no
   * persona id, no settings, no records, no owner.
   */
  getByToken: publicProcedure
    .input(z.object({ token: z.string().min(1).max(200) }))
    .use(rateLimit(RATE_LIMITS.consentPage))
    .query(async ({ input }) => {
      const persona = await findPersonaByConsentTokenHash(hashConsentToken(input.token));
      if (!persona) throw invalidLink();
      const settings = normalizePersonaSettings(persona.settings).consentLink;
      if (!settings || isConsentLinkExpired(settings.expiresAt)) throw invalidLink();
      if (settings.answeredAt) throw invalidLink();
      return { name: persona.name };
    }),

  /**
   * The answer itself.
   *
   * One answer per link. The write is re-checked under the lock, so two
   * clicks arriving together cannot both count.
   */
  answer: publicProcedure
    .input(z.object({ token: z.string().min(1).max(200), answer: consentAnswerSchema }))
    .use(rateLimit(RATE_LIMITS.consentPage))
    .mutation(async ({ input }) => {
      const tokenHash = hashConsentToken(input.token);
      const found = await findPersonaByConsentTokenHash(tokenHash);
      if (!found) throw invalidLink();
      return await withPersonaDataLock(found.id, async () => {
        const settings = await getPersonaSettings(found.id, found.userId);
        const link = normalizePersonaSettings(settings).consentLink;
        if (!link || link.tokenHash !== tokenHash) throw invalidLink();
        if (isConsentLinkExpired(link.expiresAt) || link.answeredAt) throw invalidLink();
        const answeredAt = new Date().toISOString();
        const next = mergePersonaSettings(settings, {
          consent: input.answer === "yes" ? "asked_yes" : "asked_no",
          consentLink: { tokenHash, expiresAt: link.expiresAt, answeredAt },
        });
        const written = await setPersonaSettings(found.id, found.userId, next);
        if (!written) throw invalidLink();
        return { consent: next.consent };
      });
    }),
});
