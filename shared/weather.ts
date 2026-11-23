/**
 * What a WMO weather code means, in one word (C5.2, C9.4).
 *
 * The header on the chat page and the `get_weather` tool both read the
 * same code. The header renders a translated word; the tool hands the
 * model an English one, because the model then says it in the
 * persona's own language.
 */
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

/** The English words the `get_weather` tool hands the model. */
export function weatherGroupWords(group: WeatherGroup): string {
  switch (group) {
    case "clear":
      return "clear";
    case "partly":
      return "partly cloudy";
    case "cloudy":
      return "overcast";
    case "fog":
      return "foggy";
    case "drizzle":
      return "drizzling";
    case "rain":
      return "raining";
    case "snow":
      return "snowing";
    case "shower":
      return "showers";
    case "storm":
      return "a thunderstorm";
    default:
      return "unknown weather";
  }
}
