import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { zonedDateKey } from "@shared/timezone";
import { sunTimes } from "@shared/sun";

/** The WMO weather-code groups the header can name. */
export type WeatherGroup =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "shower"
  | "storm"
  | "unknown";

/** Groups a WMO weather code into one short word. */
export function weatherGroup(code: number): WeatherGroup {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if (code === 95) return "storm";
  if (code === 96 || code === 99) return "storm";
  return "unknown";
}

function clockIn(zone: string | null, date: Date, locale: "zh" | "en"): string {
  if (!zone) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
}

/**
 * The line under their clock (C5.2).
 *
 * The city's name, the weather there, the temperature, and the nearest
 * of today's sunrise and sunset. The sun is computed here — no request
 * carries the city name or the coordinates for it. When the feature is
 * off, or the request failed, this renders nothing at all: a failed
 * lookup is not "there is no weather today".
 */
export default function TheirSide({
  personaId,
  settings: rawSettings,
  timezone,
  now,
}: {
  personaId: number;
  settings?: unknown;
  /** The reader's zone, only as a last fallback for the city's calendar. */
  timezone?: string | null;
  /** Fixed in tests. */
  now?: Date;
}) {
  const { t, locale } = useLocale();
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const settings = useMemo(() => normalizePersonaSettings(rawSettings), [rawSettings]);
  const city = settings.ldr?.city;
  const wantsWeather = Boolean(settings.ldr?.weather && city);
  const status = trpc.ldr.status.useQuery();
  const weather = trpc.ldr.weather.useQuery(
    { personaId },
    {
      enabled: wantsWeather && status.data?.enabled !== false,
      refetchInterval: 30 * 60_000,
    },
  );

  if (!wantsWeather || status.data?.enabled === false || !city) return null;
  const data = weather.data;
  if (!data) return null;

  const at = now ?? new Date(tick);
  const zone = city.timezone ?? data.timezone ?? timezone ?? null;
  const group = weatherGroup(data.weatherCode);
  const temp = Math.round(data.temperature);

  const today = zonedDateKey(at, zone);
  let sunLabel = "";
  let sunTime = "";
  let sun = sunTimes(today, city.lat, city.lng);
  const candidates: Array<{ kind: "sunrise" | "sunset"; at: Date }> = [];
  if (sun) {
    if (sun.sunrise.getTime() > at.getTime()) candidates.push({ kind: "sunrise", at: sun.sunrise });
    if (sun.sunset.getTime() > at.getTime()) candidates.push({ kind: "sunset", at: sun.sunset });
  }
  if (candidates.length === 0) {
    // Both have passed: the next light is tomorrow's sunrise.
    const tomorrow = zonedDateKey(new Date(at.getTime() + 24 * 60 * 60 * 1000), zone);
    sun = sunTimes(tomorrow, city.lat, city.lng);
    if (sun) candidates.push({ kind: "sunrise", at: sun.sunrise });
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
    const next = candidates[0];
    sunLabel = next.kind === "sunrise" ? t("theirWeather.sunrise") : t("theirWeather.sunset");
    sunTime = clockIn(zone, next.at, locale === "en" ? "en" : "zh");
  }

  const weatherWords = `${t(`theirWeather.code.${group}` as never)} ${temp}°`;
  return (
    <p className="text-[0.625rem] text-muted-subtle truncate">
      {city.name} · {weatherWords}
      {sunLabel ? ` · ${sunLabel} ${sunTime}` : ""}
    </p>
  );
}
