/**
 * The patch `persona.updateSettings` accepts.
 *
 * Each field is optional; unknown keys are refused. The normaliser
 * still fills defaults and clamps after the merge.
 */
import { z } from "zod";

const layerPatch = z
  .object({
    seededTurns: z.boolean().optional(),
    ritualTable: z.boolean().optional(),
    styleReminder: z.boolean().optional(),
    styleProjection: z.boolean().optional(),
    lengthCap: z.boolean().optional(),
    actClusters: z.boolean().optional(),
    emotionInertia: z.boolean().optional(),
    closing: z.boolean().optional(),
    stickers: z.boolean().optional(),
    factAnnotate: z.boolean().optional(),
    twoStage: z.boolean().optional(),
    factRewrite: z.boolean().optional(),
    abPairs: z.boolean().optional(),
    tools: z.boolean().optional(),
    voiceNotes: z.boolean().optional(),
    photos: z.boolean().optional(),
    callMode: z.boolean().optional(),
  })
  .strict();

export const personaSettingsPatchSchema = z
  .object({
    layers: layerPatch.optional(),
    timing: z
      .object({
        typing: z.boolean().optional(),
        asyncDelivery: z.boolean().optional(),
        maxDelayMinutes: z.number().optional(),
        sleep: z.boolean().optional(),
        followUp: z.boolean().optional(),
        recall: z.boolean().optional(),
      })
      .strict()
      .optional(),
    sampling: z
      .object({
        temperature: z.number().optional(),
        topP: z.number().optional(),
        presencePenalty: z.number().optional(),
        frequencyPenalty: z.number().optional(),
      })
      .strict()
      .optional(),
    providers: z
      .object({
        planner: z.string().optional(),
        voice: z.string().optional(),
      })
      .strict()
      .optional(),
    skin: z
      .object({
        theme: z.enum(["classic", "im-green", "im-blue"]),
        alias: z.string().optional(),
        background: z.string().optional(),
      })
      .strict()
      .optional(),
    ldr: z
      .object({
        nextMeetAt: z.string().optional(),
        city: z
          .object({
            name: z.string(),
            lat: z.number(),
            lng: z.number(),
          })
          .strict()
          .optional(),
        weather: z.boolean(),
      })
      .strict()
      .optional(),
    taper: z
      .object({
        stage: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        overrideDay: z.string().optional(),
      })
      .strict()
      .optional(),
    seal: z
      .object({
        until: z.string().optional(),
        earlyOpen: z.enum(["never", "cooling"]),
        requestedAt: z.string().optional(),
      })
      .strict()
      .optional(),
    mode: z.enum(["default", "memorial"]).optional(),
    memorial: z
      .object({
        birthday: z.string().optional(),
        deathday: z.string().optional(),
      })
      .strict()
      .optional(),
    graduationKind: z.enum(["farewell", "said_it", "reconciled", "not_afraid"]).optional(),
    keptQuotes: z
      .array(
        z
          .object({
            recordId: z.number(),
            text: z.string(),
            at: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    consent: z.enum(["asked_yes", "asked_no", "not_asked", "cannot_ask"]).optional(),
    locked: z.boolean().optional(),
    unreachableSince: z.string().optional(),
    lastReunion: z
      .object({
        from: z.string(),
        to: z.string(),
        dismissed: z.boolean().optional(),
      })
      .strict()
      .optional(),
    onThisDay: z.boolean().optional(),
    letterEmail: z.boolean().optional(),
    revisit: z.boolean().optional(),
    saidItHintShown: z.boolean().optional(),
    consentLink: z
      .object({
        tokenHash: z.string(),
        expiresAt: z.string(),
        answeredAt: z.string().optional(),
      })
      .strict()
      .optional(),
    disabledProfiles: z.array(z.string()).optional(),
  })
  .strict();
