import { describe, expect, it } from "vitest";
import { nextSunEvent, sunTimes } from "./sun";
import { zonedDateKey } from "./timezone";

/**
 * The reference times below are from sunrise-sunset.org, which uses the
 * NOAA solar calculator — the same formulas as `sun.ts` — and are
 * cross-checked against timeanddate.com:
 *
 *   https://api.sunrise-sunset.org/json?lat=31.2304&lng=121.4737&date=2024-06-21&formatted=0
 *   https://www.timeanddate.com/sun/china/shanghai?month=6&year=2024
 *   https://www.timeanddate.com/sun/australia/sydney?month=12&year=2024
 *   https://www.timeanddate.com/sun/norway/tromso?month=3&year=2024
 *
 * The tolerance is three minutes: the algorithm is good to about one,
 * and the remaining difference is the site's own rounding of the
 * observer's coordinates and the horizon definition.
 */

const MINUTE = 60_000;

function minutesBetween(actual: Date | undefined, expected: string): number {
  expect(actual).toBeInstanceOf(Date);
  return Math.abs((actual as Date).getTime() - new Date(expected).getTime()) / MINUTE;
}

interface Case {
  place: string;
  latitude: number;
  longitude: number;
  day: string;
  sunrise: string | null;
  sunset: string | null;
}

const CASES: Case[] = [
  // Shanghai, 31.2304 N, 121.4737 E.
  {
    place: "Shanghai",
    latitude: 31.2304,
    longitude: 121.4737,
    day: "2024-03-20",
    sunrise: "2024-03-19T21:57:29Z",
    sunset: "2024-03-20T10:05:32Z",
  },
  {
    place: "Shanghai",
    latitude: 31.2304,
    longitude: 121.4737,
    day: "2024-06-21",
    sunrise: "2024-06-20T20:50:31Z",
    sunset: "2024-06-21T11:01:23Z",
  },
  {
    place: "Shanghai",
    latitude: 31.2304,
    longitude: 121.4737,
    day: "2024-12-21",
    sunrise: "2024-12-20T22:48:42Z",
    sunset: "2024-12-21T08:55:47Z",
  },
  // Sydney, 33.8688 S — the southern hemisphere.
  {
    place: "Sydney",
    latitude: -33.8688,
    longitude: 151.2093,
    day: "2024-03-20",
    sunrise: "2024-03-19T19:58:27Z",
    sunset: "2024-03-20T08:06:44Z",
  },
  {
    place: "Sydney",
    latitude: -33.8688,
    longitude: 151.2093,
    day: "2024-06-21",
    sunrise: "2024-06-20T21:00:01Z",
    sunset: "2024-06-21T06:53:58Z",
  },
  {
    place: "Sydney",
    latitude: -33.8688,
    longitude: 151.2093,
    day: "2024-12-21",
    sunrise: "2024-12-20T18:40:54Z",
    sunset: "2024-12-21T09:05:37Z",
  },
  // Tromsø, 69.6492 N — midnight sun on 21 June, polar night on 21 December.
  {
    place: "Tromsø",
    latitude: 69.6492,
    longitude: 18.9553,
    day: "2024-03-20",
    sunrise: "2024-03-20T04:40:19Z",
    sunset: "2024-03-20T17:02:41Z",
  },
  { place: "Tromsø", latitude: 69.6492, longitude: 18.9553, day: "2024-06-21", sunrise: null, sunset: null },
  { place: "Tromsø", latitude: 69.6492, longitude: 18.9553, day: "2024-12-21", sunrise: null, sunset: null },
  // New York, across the date line from the others in winter.
  {
    place: "New York",
    latitude: 40.7128,
    longitude: -74.006,
    day: "2024-03-20",
    sunrise: "2024-03-20T10:57:59Z",
    sunset: "2024-03-20T23:08:33Z",
  },
];

describe("the sun over a place and a day (C5.2)", () => {
  for (const item of CASES) {
    it(`matches the published times for ${item.place} on ${item.day}`, () => {
      const times = sunTimes(item.day, item.latitude, item.longitude);
      if (item.sunrise === null || item.sunset === null) {
        expect(times).toBeNull();
        return;
      }
      expect(times).not.toBeNull();
      expect(minutesBetween(times?.sunrise, item.sunrise)).toBeLessThanOrEqual(3);
      expect(minutesBetween(times?.sunset, item.sunset)).toBeLessThanOrEqual(3);
      // Sunrise is before sunset, always.
      expect(times!.sunrise.getTime()).toBeLessThan(times!.sunset.getTime());
    });
  }

  it("does not use the server's calendar day", () => {
    // A day-only value is that place's day. The function is handed the
    // day explicitly; a Date is read as its UTC day, which the caller
    // has already moved into the place's zone.
    const birthday = sunTimes(new Date("2024-06-21T00:00:00Z"), 31.2304, 121.4737);
    expect(birthday).toEqual(sunTimes("2024-06-21", 31.2304, 121.4737));
  });

  it("returns null for values it cannot read", () => {
    expect(sunTimes("2024-02-30", 31.2304, 121.4737)).toBeNull();
    expect(sunTimes("not-a-day", 31.2304, 121.4737)).toBeNull();
    expect(sunTimes("2024-06-21", 91, 0)).toBeNull();
    expect(sunTimes("2024-06-21", 0, 181)).toBeNull();
    expect(sunTimes("2024-06-21", Number.NaN, 0)).toBeNull();
  });
});

describe("the next light on the city's own calendar (C5.2)", () => {
  // Apia is UTC+13 at longitude 171.75 W; Kiritimati is UTC+14 at
  // 157.4 W. Their local day is a day ahead of UTC, so events computed
  // for the local day-key as a UTC day land on the following local day.
  const APIA = { latitude: -13.8333, longitude: -171.75, zone: "Pacific/Apia" };
  const KIRITIMATI = { latitude: 1.8721, longitude: -157.4278, zone: "Pacific/Kiritimati" };

  it("shows today's sunset at local noon in Apia, not tomorrow's sunrise", () => {
    // 2026-03-01 12:00 in Apia is 2026-02-28T23:00Z.
    const at = new Date("2026-02-28T23:00:00Z");
    const next = nextSunEvent(at, APIA.latitude, APIA.longitude, APIA.zone);
    expect(next).not.toBeNull();
    expect(next!.kind).toBe("sunset");
    expect(zonedDateKey(next!.at, APIA.zone)).toBe("2026-03-01");
    expect(next!.at.getTime()).toBeGreaterThan(at.getTime());
    // Apia's sunset is around 18:30 in March.
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: APIA.zone }).format(next!.at),
    );
    expect(hour).toBeGreaterThanOrEqual(16);
    expect(hour).toBeLessThanOrEqual(20);
  });

  it("shows today's sunset at local noon in Kiritimati", () => {
    // 2026-03-01 12:00 in Kiritimati is 2026-02-28T22:00Z.
    const at = new Date("2026-02-28T22:00:00Z");
    const next = nextSunEvent(at, KIRITIMATI.latitude, KIRITIMATI.longitude, KIRITIMATI.zone);
    expect(next).not.toBeNull();
    expect(next!.kind).toBe("sunset");
    expect(zonedDateKey(next!.at, KIRITIMATI.zone)).toBe("2026-03-01");
  });

  it("keeps Shanghai and New York on the same answers as before", () => {
    // Noon in Shanghai: today's sunset is the next light.
    const shanghaiNoon = new Date("2026-03-01T04:00:00Z");
    const shanghai = nextSunEvent(shanghaiNoon, 31.2304, 121.4737, "Asia/Shanghai");
    expect(shanghai!.kind).toBe("sunset");
    expect(zonedDateKey(shanghai!.at, "Asia/Shanghai")).toBe("2026-03-01");
    expect(shanghai!.at.toISOString()).toBe(
      sunTimes("2026-03-01", 31.2304, 121.4737)!.sunset.toISOString(),
    );

    // 20:00 in New York: both of today's events are past, so tomorrow's
    // sunrise is the next light.
    const nyEvening = new Date("2026-03-02T01:00:00Z");
    const ny = nextSunEvent(nyEvening, 40.7128, -74.006, "America/New_York");
    expect(ny!.kind).toBe("sunrise");
    expect(zonedDateKey(ny!.at, "America/New_York")).toBe("2026-03-02");

    // Early morning: today's sunrise, not tomorrow's.
    const nyMorning = new Date("2026-03-01T10:00:00Z");
    const morning = nextSunEvent(nyMorning, 40.7128, -74.006, "America/New_York");
    expect(morning!.kind).toBe("sunrise");
    expect(zonedDateKey(morning!.at, "America/New_York")).toBe("2026-03-01");
  });

  it("has no next light during the polar night", () => {
    const at = new Date("2024-12-21T12:00:00Z");
    expect(nextSunEvent(at, 69.6492, 18.9553, "Europe/Oslo")).toBeNull();
  });
});
