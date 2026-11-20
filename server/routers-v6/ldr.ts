/**
 * The other side of a long distance (C5.2).
 *
 * Two routes, both off until the user asks:
 *
 *   - `searchCity` sends the word the user typed to Open-Meteo's
 *     geocoding API, only when they press the search button.
 *   - `weather` sends a coordinate rounded to two decimals, only while
 *     the persona's weather switch is on. The city name, the records and
 *     anything about the user stay on this machine.
 *
 * Endpoints and parameters, checked against the official documentation
 * on 2026-11-20:
 *   https://open-meteo.com/en/docs/geocoding-api
 *   https://open-meteo.com/en/docs (forecast, `current=temperature_2m,weather_code,is_day`)
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { protectedProcedure, router } from "../_core/trpc";
import { getPersonaById, getPersonaSettings } from "../db";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** The weather is off unless the operator leaves it on. */
export function weatherEnabled(): boolean {
  return process.env.WEATHER_ENABLED !== "false";
}

export interface WeatherPayload {
  city: string;
  temperature: number;
  weatherCode: number;
  isDay: boolean;
  timezone: string | null;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; data: WeatherPayload }>();

/** Empty the in-memory cache. Exists so tests do not share 30 minutes. */
export function resetLdrWeatherCache(): void {
  cache.clear();
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function cityKey(latitude: number, longitude: number): string {
  return `${rounded(latitude).toFixed(2)},${rounded(longitude).toFixed(2)}`;
}

async function searchOpenMeteo(name: string, locale: "zh" | "en") {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", name);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", locale === "en" ? "en" : "zh");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    results?: Array<{
      name?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      country?: unknown;
      admin1?: unknown;
      timezone?: unknown;
    }>;
  };
  if (!Array.isArray(payload.results)) return [];
  return payload.results.flatMap((row) => {
    if (
      typeof row.name !== "string" ||
      typeof row.latitude !== "number" ||
      typeof row.longitude !== "number"
    ) {
      return [];
    }
    return [{
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
      country: typeof row.country === "string" ? row.country : null,
      admin1: typeof row.admin1 === "string" ? row.admin1 : null,
      timezone: typeof row.timezone === "string" ? row.timezone : null,
    }];
  });
}

async function fetchWeather(
  city: { name: string; lat: number; lng: number; timezone?: string },
): Promise<WeatherPayload | null> {
  const key = cityKey(city.lat, city.lng);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.data;

  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", rounded(city.lat).toFixed(2));
  url.searchParams.set("longitude", rounded(city.lng).toFixed(2));
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("timezone", "auto");
  let payload: {
    timezone?: unknown;
    current?: { temperature_2m?: unknown; weather_code?: unknown; is_day?: unknown };
  };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    payload = (await response.json()) as typeof payload;
  } catch {
    return null;
  }
  const current = payload.current;
  if (
    !current ||
    typeof current.temperature_2m !== "number" ||
    typeof current.weather_code !== "number"
  ) {
    return null;
  }
  const data: WeatherPayload = {
    city: city.name,
    temperature: current.temperature_2m,
    weatherCode: current.weather_code,
    isDay: current.is_day === 1,
    timezone:
      city.timezone ??
      (typeof payload.timezone === "string" ? payload.timezone : null),
  };
  cache.set(key, { at: now, data });
  return data;
}

export const ldrRouter = router({
  /** Whether the operator left the weather feature on at all. */
  status: protectedProcedure.query(() => ({ enabled: weatherEnabled() })),

  searchCity: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      if (!weatherEnabled()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: copy(ctx.locale, "errors.weatherDisabled"),
        });
      }
      const results = await searchOpenMeteo(input.name, ctx.locale === "en" ? "en" : "zh");
      return { results };
    }),

  weather: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      if (!weatherEnabled()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: copy(ctx.locale, "errors.weatherDisabled"),
        });
      }
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const settings = normalizePersonaSettings(
        (await getPersonaSettings(input.personaId, ctx.user.id)) ?? null,
      );
      const city = settings.ldr?.city;
      if (!settings.ldr?.weather || !city) return null;
      return await fetchWeather(city);
    }),
});
