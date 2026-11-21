import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, rateLimit, router } from "./trpc";
import { RATE_LIMITS } from "./rate-limit";
import { registry } from "../llm";
import { hasFfmpeg } from "./ffmpeg";
import { sttIsLocal, sttEngine } from "./stt";
import { ttsEngine } from "./tts";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  /**
   * What this server can do.
   *
   * The client uses it to decide whether to stream a reply or to fall back
   * to the ordinary request — without having to discover the answer by
   * making a request that fails.
   */
  capabilities: publicProcedure.query(async () => {
    const configured = registry.list().filter((p) => p.configured);
    return {
      streaming: true,
      /** The provider that would be used when the client does not choose one. */
      defaultProvider: registry.getDefaultName() || null,
      providers: configured.map((p) => p.name),
      /** The optional local tools (B7.10). Missing is not a failure. */
      ffmpeg: await hasFfmpeg(),
      sttLocal: sttIsLocal(),
      sttEngine: sttEngine(),
      ttsEngine: ttsEngine(),
      /** The configured providers that can look at a picture (B7.11). */
      visionProviders: configured
        .filter((p) => registry.get(p.name)?.capabilities.vision)
        .map((p) => p.name),
    };
  }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await notifyOwner(input, ctx.user.id);
      return {
        success: result.delivered,
        channel: result.channel,
        ...(result.reason ? { reason: result.reason } : {}),
      } as const;
    }),

  /**
   * One-click diagnosis (C8.12).
   *
   * Runs every self-check and returns the results, problems first. It is a
   * mutation rather than a query because it is not a read: it sends one
   * real request to every configured model, and the rate limit below keeps
   * that to once a minute per user.
   *
   * The logic and its real dependencies are imported when the button is
   * pressed. The diagnosis is the only caller, and importing the model
   * registry, the scheduler and the channel adapters on every server start
   * — for a button most people press rarely — is not worth it.
   */
  diagnose: protectedProcedure
    .use(rateLimit(RATE_LIMITS.diagnose))
    .mutation(async ({ ctx }) => {
      const [{ runDiagnose }, { createDiagnoseDeps }] = await Promise.all([
        import("../system/diagnose"),
        import("../system/diagnose-deps"),
      ]);
      return runDiagnose({
        locale: ctx.locale,
        deps: createDiagnoseDeps(ctx.user.id),
      });
    }),
});
