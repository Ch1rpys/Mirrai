/**
 * The three small things a persona may do for the user (C9.4).
 *
 * This is the `tools` switch in the second half of the persona's
 * settings. All three are off by default: turning them on costs a round
 * of model calls and gives the reply access to something the app can
 * actually do — set a reminder, send a real photo, look at the weather
 * on their side.
 *
 * Rules that hold for all three:
 *
 *   - a memorial persona never gets them (it is not a service window);
 *   - they only exist on the web channel and never in an evaluation —
 *     the caller decides that, this module only builds them;
 *   - a tool can only touch rows that belong to this owner and this
 *     persona.
 */
import { z } from "zod";
import type { LLMToolDef } from "../llm/types";
import type { ToolHandler } from "../llm/tools";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { weatherGroup, weatherGroupWords } from "@shared/weather";
import * as db from "../db";
import { fetchWeather } from "../routers-v6/ldr";
import type { Persona } from "../../drizzle/schema";

/** The names the model calls. Kept in one place so tests and code agree. */
export const PERSONA_TOOL_NAMES = ["set_reminder", "send_photo", "get_weather"] as const;
export type PersonaToolName = (typeof PERSONA_TOOL_NAMES)[number];

/** The reminder has to be soon enough to matter, and far enough to be later. */
export const REMINDER_MIN_MINUTES = 5;
export const REMINDER_MAX_MINUTES = 1440;
/** One reminder at a time per persona. A second one replaces nothing. */
export const MAX_PENDING_REMINDERS = 1;

export const PERSONA_TOOL_DEFINITIONS: Record<PersonaToolName, LLMToolDef> = {
  set_reminder: {
    name: "set_reminder",
    description:
      "Remember something the user asked you to bring up later. Call this when they say they will do something and want you to ask about it (for example, they say they will tell you when they get home). Give the exact thing to ask about and how many minutes later to ask. You cannot set two reminders at once. Do not use it for anything the user did not ask you to remember.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The thing the user asked you to ask about, in their own words.",
        },
        afterMinutes: {
          type: "integer",
          description: "How many minutes later to ask. Between 5 and 1440.",
        },
      },
      required: ["text", "afterMinutes"],
      additionalProperties: false,
    },
  },
  send_photo: {
    name: "send_photo",
    description:
      "Send a real photograph that the user attached to one of their memories. Call this when the conversation is about that memory and a picture would say something. Only a photo that is actually stored can be sent; there is no random photo and no generated one.",
    parameters: {
      type: "object",
      properties: {
        memoryId: {
          type: "integer",
          description: "The id of the memory whose photo to send.",
        },
      },
      required: ["memoryId"],
      additionalProperties: false,
    },
  },
  get_weather: {
    name: "get_weather",
    description:
      "Look at the weather where you are right now. Call this when the user asks about your day or the weather on your side. It returns the city, the temperature in Celsius and a short description.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
};

const setReminderSchema = z.object({
  text: z.string().trim().min(1).max(200),
  afterMinutes: z
    .number()
    .refine(Number.isInteger, { message: "must be a whole number of minutes" })
    .min(REMINDER_MIN_MINUTES)
    .max(REMINDER_MAX_MINUTES),
});

const sendPhotoSchema = z.object({
  memoryId: z.number().refine(Number.isInteger, { message: "must be an integer" }).positive(),
});

const getWeatherSchema = z.object({});

/** A photo the tool chose, handed to the caller to store after the words. */
export interface ToolPhoto {
  mediaId: number;
  url: string;
  at: Date | null;
  memoryId: number;
  caption?: string | null;
}

export interface PersonaToolContext {
  persona: Persona;
  userId: number;
  now: Date;
  /** The photo the model sent, if it called `send_photo`. */
  onPhoto?: (photo: ToolPhoto) => void;
}

export interface PersonaTools {
  defs: LLMToolDef[];
  handlers: Record<string, ToolHandler>;
}

/**
 * The tools this persona may use right now.
 *
 * `get_weather` only exists when the user turned the weather on: the
 * switch that lets the app ask Open-Meteo is the same switch that lets
 * the persona look, and an offer without the data would be a lie.
 */
export async function buildPersonaTools(
  context: PersonaToolContext,
): Promise<PersonaTools> {
  const settings = normalizePersonaSettings(context.persona.settings);
  const defs: LLMToolDef[] = [
    PERSONA_TOOL_DEFINITIONS.set_reminder,
    PERSONA_TOOL_DEFINITIONS.send_photo,
  ];
  if (settings.ldr?.weather && settings.ldr?.city) {
    defs.push(PERSONA_TOOL_DEFINITIONS.get_weather);
  }

  const handlers: Record<string, ToolHandler> = {
    set_reminder: {
      schema: setReminderSchema,
      run: async (input: { text: string; afterMinutes: number }) => {
        const pending = await db.countPendingCheckIns(context.persona.id, context.userId);
        if (pending >= MAX_PENDING_REMINDERS) {
          return "You are already holding one reminder for them. It has not been asked yet, so this one was not set.";
        }
        const dueAt = new Date(context.now.getTime() + input.afterMinutes * 60_000);
        await db.createScheduledItem({
          userId: context.userId,
          personaId: context.persona.id,
          kind: "check_in",
          body: input.text,
          dueAt,
        });
        return "The reminder is set. Only if they have not written to you before then, you will ask about it later.";
      },
    },
    send_photo: {
      schema: sendPhotoSchema,
      run: async (input: { memoryId: number }) => {
        const memory = await db.getMemoryById(input.memoryId, context.userId);
        if (!memory || memory.personaId !== context.persona.id) {
          return "There is no such memory for you, so nothing was sent.";
        }
        const photos = (await db.listMemoryMedia(input.memoryId, context.userId))
          .filter(row => row.kind === "photo");
        const photo = photos[0];
        if (!photo) {
          return "That memory has no photograph attached, so nothing was sent.";
        }
        context.onPhoto?.({
          mediaId: photo.mediaId,
          url: `/uploads/${photo.fileKey}`,
          at: photo.at ?? null,
          memoryId: input.memoryId,
        });
        return "The photograph was sent.";
      },
    },
  };

  if (defs.some(def => def.name === "get_weather")) {
    handlers.get_weather = {
      schema: getWeatherSchema,
      run: async () => {
        const city = settings.ldr?.city;
        if (!city) return "You do not know where you are right now.";
        const weather = await fetchWeather(city);
        if (!weather) return "The weather could not be read right now.";
        const group = weatherGroup(weather.weatherCode);
        const part = weather.isDay ? "daytime" : "night";
        return `It is ${weatherGroupWords(group)}, ${Math.round(weather.temperature)}°C, ${part} in ${weather.city}.`;
      },
    };
  }

  return { defs, handlers };
}
