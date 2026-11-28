/**
 * Sunrise and sunset, computed on this machine (C5.2).
 *
 * The weather itself comes from Open-Meteo, but the light does not need
 * the network: the sun's position over a place and a day is arithmetic.
 * Keeping this local means the header can say "sunset 16:55" without
 * sending the city anywhere, and it works when the weather request
 * fails.
 *
 * The formulas are the NOAA Solar Calculator's (Global Monitoring
 * Division): fractional year, equation of time, solar declination, and
 * the hour angle at the official horizon of 90.833° — 90° plus the
 * solar radius and atmospheric refraction.
 *
 *   https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 *   https://gml.noaa.gov/grad/solcalc/calcdetails.html
 *
 * A day-only value is the local calendar day at the place, not UTC:
 * asking for the sunrise "on the 21st" in Shanghai must not return the
 * 20th because the server is on another clock.
 */

import { zonedDateKey } from "./timezone";

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

const RAD = Math.PI / 180;

/** Days since 1 January of that year, 1-based. */
function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 1);
  const at = Date.UTC(year, month - 1, day);
  return Math.floor((at - start) / 86_400_000) + 1;
}

function parseDay(date: string | Date): { year: number; month: number; day: number } | null {
  if (date instanceof Date) {
    if (!Number.isFinite(date.getTime())) return null;
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // "2024-02-30" is not a day; Date.UTC would quietly roll it into March.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * The sunrise and sunset at a place on a calendar day.
 *
 * Returns UTC instants. `null` means the sun does not rise or set that
 * day at all: the polar day has no sunset and the polar night has no
 * sunrise.
 */
export function sunTimes(
  date: string | Date,
  latitude: number,
  longitude: number,
): SunTimes | null {
  const day = parseDay(date);
  if (!day) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const n = dayOfYear(day.year, day.month, day.day);
  const gamma = (2 * Math.PI / 365) * (n - 1);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const latitudeRad = latitude * RAD;
  const cosHourAngle =
    Math.cos(90.833 * RAD) / (Math.cos(latitudeRad) * Math.cos(declination)) -
    Math.tan(latitudeRad) * Math.tan(declination);
  // No crossing of the horizon that day.
  if (cosHourAngle > 1 || cosHourAngle < -1) return null;

  const hourAngle = Math.acos(cosHourAngle) / RAD;
  // Minutes after 00:00 UTC of that calendar day.
  const sunriseMinutes = 720 - 4 * (longitude + hourAngle) - equationOfTime;
  const sunsetMinutes = 720 - 4 * (longitude - hourAngle) - equationOfTime;
  const midnight = Date.UTC(day.year, day.month - 1, day.day);
  return {
    sunrise: new Date(midnight + sunriseMinutes * 60_000),
    sunset: new Date(midnight + sunsetMinutes * 60_000),
  };
}

/** The local calendar day key `deltaDays` away from `dayKey`. */
function shiftDayKey(dayKey: string, deltaDays: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/** The next sunrise or sunset, and which one it is. */
export interface SunEvent {
  kind: "sunrise" | "sunset";
  at: Date;
}

/**
 * The next sunrise or sunset at a place, on the place's own calendar (C5.2).
 *
 * `sunTimes` computes the events of one UTC calendar day, but the day a
 * city lives in is its local one. Near the date line the two disagree:
 * Apia (UTC+13) at local noon is still on the previous UTC day, so the
 * events computed for the local day-key land on the *next* local day —
 * the header showed tomorrow's sunrise instead of today's sunset.
 *
 * So the candidates are assembled from the UTC days on either side of
 * the local target day, each event is kept only when its local calendar
 * date is the target, and the earliest event still ahead is the answer.
 * A local day is at most one UTC day away from its own date, and the
 * extra day handles the "everything today has passed" case.
 */
export function nextSunEvent(
  at: Date,
  latitude: number,
  longitude: number,
  timeZone: string | null | undefined,
): SunEvent | null {
  if (!Number.isFinite(at.getTime())) return null;
  const zone = timeZone || "UTC";
  const today = zonedDateKey(at, zone);
  for (const target of [today, shiftDayKey(today, 1)]) {
    const candidates: SunEvent[] = [];
    for (const delta of [-1, 0, 1]) {
      const sun = sunTimes(shiftDayKey(target, delta), latitude, longitude);
      if (!sun) continue;
      const events: Array<[SunEvent["kind"], Date]> = [
        ["sunrise", sun.sunrise],
        ["sunset", sun.sunset],
      ];
      for (const [kind, when] of events) {
        if (zonedDateKey(when, zone) !== target) continue;
        if (when.getTime() <= at.getTime()) continue;
        candidates.push({ kind, at: when });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
      return candidates[0];
    }
  }
  return null;
}
