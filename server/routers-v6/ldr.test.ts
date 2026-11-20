import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.fn();
const getPersonaSettings = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  getPersonaSettings: (...args: unknown[]) => getPersonaSettings(...args),
}));

import { appRouter } from "../routers";
import { resetLdrWeatherCache } from "./ldr";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: `User ${userId}`,
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

const SHANGHAI = {
  name: "上海",
  lat: 31.2304,
  lng: 121.4737,
  timezone: "Asia/Shanghai",
};

function weatherResponse() {
  return {
    ok: true,
    json: async () => ({
      timezone: "Asia/Shanghai",
      current: { temperature_2m: 10.6, weather_code: 0, is_day: 1 },
    }),
  };
}

function geocodingResponse() {
  return {
    ok: true,
    json: async () => ({
      results: [
        {
          name: "柏林",
          latitude: 52.52437,
          longitude: 13.41053,
          country: "德国",
          admin1: "柏林",
          timezone: "Europe/Berlin",
        },
        { name: "柏林", latitude: 44.46867, longitude: -71.18508, country: "美国" },
        { nonsense: true },
      ],
    }),
  };
}

describe("the weather on their side (C5.2)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetLdrWeatherCache();
    vi.stubGlobal("fetch", fetchMock);
    getPersonaById.mockImplementation(async (id: number, userId: number) =>
      id === 1 && userId === 1 ? { id: 1, userId: 1, name: "小满" } : null,
    );
    getPersonaSettings.mockResolvedValue({
      ldr: { weather: true, city: SHANGHAI },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.WEATHER_ENABLED;
  });

  it("sends the typed city name only when the user searches", async () => {
    fetchMock.mockImplementation(async () => geocodingResponse());
    const found = await appRouter.createCaller(ctxFor(1)).ldr.searchCity({ name: "柏林" });
    expect(found.results).toEqual([
      {
        name: "柏林",
        latitude: 52.52437,
        longitude: 13.41053,
        country: "德国",
        admin1: "柏林",
        timezone: "Europe/Berlin",
      },
      {
        name: "柏林",
        latitude: 44.46867,
        longitude: -71.18508,
        country: "美国",
        admin1: null,
        timezone: null,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("geocoding-api.open-meteo.com/v1/search");
    expect(url).toContain("name=%E6%9F%8F%E6%9E%97");
    expect(url).not.toContain("userId");
  });

  it("asks for no weather while the switch is off", async () => {
    getPersonaSettings.mockResolvedValue({ ldr: { weather: false, city: SHANGHAI } });
    const result = await appRouter.createCaller(ctxFor(1)).ldr.weather({ personaId: 1 });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks with a rounded coordinate, no city and no user", async () => {
    fetchMock.mockImplementation(async () => weatherResponse());
    const result = await appRouter.createCaller(ctxFor(1)).ldr.weather({ personaId: 1 });
    expect(result).toEqual({
      city: "上海",
      temperature: 10.6,
      weatherCode: 0,
      isDay: true,
      timezone: "Asia/Shanghai",
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("api.open-meteo.com/v1/forecast");
    expect(url).toContain("latitude=31.23");
    expect(url).toContain("longitude=121.47");
    expect(url).not.toContain("%E4%B8%8A%E6%B5%B7"); // 上海
    expect(url).not.toContain("userId");
    expect(url).not.toContain("persona");
  });

  it("reuses the answer for thirty minutes and then asks again", async () => {
    let now = new Date("2026-03-01T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    fetchMock.mockImplementation(async () => weatherResponse());
    const caller = appRouter.createCaller(ctxFor(1));
    await caller.ldr.weather({ personaId: 1 });
    await caller.ldr.weather({ personaId: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 29 * 60 * 1000;
    await caller.ldr.weather({ personaId: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 2 * 60 * 1000;
    await caller.ldr.weather({ personaId: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null instead of throwing when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(
      appRouter.createCaller(ctxFor(1)).ldr.weather({ personaId: 1 }),
    ).resolves.toBeNull();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(
      appRouter.createCaller(ctxFor(1)).ldr.weather({ personaId: 1 }),
    ).resolves.toBeNull();
  });

  it("does not read another user's persona", async () => {
    await expect(
      appRouter.createCaller(ctxFor(2)).ldr.weather({ personaId: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses both routes when WEATHER_ENABLED is false", async () => {
    process.env.WEATHER_ENABLED = "false";
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.ldr.searchCity({ name: "柏林" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.ldr.weather({ personaId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.ldr.status()).resolves.toEqual({ enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
