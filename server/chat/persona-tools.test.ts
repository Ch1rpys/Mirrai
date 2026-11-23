/**
 * The three things a persona may actually do (C9.4).
 *
 * The handlers are what the model's arguments reach: a reminder is a
 * row with a moment, a photo is a photo the user really attached, and
 * the weather is the same lookup the header uses. Everything here is
 * exercised through the handler, not through a model.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const countPendingCheckIns = vi.fn();
const createScheduledItem = vi.fn();
const getMemoryById = vi.fn();
const listMemoryMedia = vi.fn();
const fetchWeather = vi.fn();

vi.mock("../db", () => ({
  countPendingCheckIns: (...args: unknown[]) => countPendingCheckIns(...args),
  createScheduledItem: (...args: unknown[]) => createScheduledItem(...args),
  getMemoryById: (...args: unknown[]) => getMemoryById(...args),
  listMemoryMedia: (...args: unknown[]) => listMemoryMedia(...args),
}));

vi.mock("../routers-v6/ldr", () => ({
  fetchWeather: (...args: unknown[]) => fetchWeather(...args),
}));

import { buildPersonaTools, REMINDER_MAX_MINUTES, REMINDER_MIN_MINUTES } from "./persona-tools";

const NOW = new Date("2026-03-01T12:00:00Z");

function persona(settings: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小满",
    settings,
    personaData: {},
  } as any;
}

const weatherOn = {
  ldr: { weather: true, city: { name: "上海", lat: 31.23, lng: 121.47, timezone: "Asia/Shanghai" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  countPendingCheckIns.mockResolvedValue(0);
  createScheduledItem.mockResolvedValue({ id: 9 });
  getMemoryById.mockResolvedValue({ id: 3, personaId: 1, userId: 1 });
  listMemoryMedia.mockResolvedValue([
    { mediaId: 5, kind: "photo", fileKey: "photos/5.jpg", at: new Date("2022-04-02T10:00:00Z") },
  ]);
  fetchWeather.mockResolvedValue({
    city: "上海",
    temperature: 12.4,
    weatherCode: 3,
    isDay: true,
    timezone: "Asia/Shanghai",
  });
});

describe("which tools a persona gets", () => {
  it("does not offer the weather when the switch is off", async () => {
    const tools = await buildPersonaTools({ persona: persona(), userId: 1, now: NOW });
    expect(tools.defs.map(def => def.name)).toEqual(["set_reminder", "send_photo"]);
    expect(tools.handlers.get_weather).toBeUndefined();
  });

  it("offers the weather when the switch is on", async () => {
    const tools = await buildPersonaTools({ persona: persona(weatherOn), userId: 1, now: NOW });
    expect(tools.defs.map(def => def.name)).toEqual(["set_reminder", "send_photo", "get_weather"]);
    expect(tools.handlers.get_weather).toBeDefined();
  });

  it("does not offer the weather when the place is unknown", async () => {
    const tools = await buildPersonaTools({
      persona: persona({ ldr: { weather: true } }),
      userId: 1,
      now: NOW,
    });
    expect(tools.defs.map(def => def.name)).not.toContain("get_weather");
  });
});

describe("set_reminder", () => {
  it("stores one check-in at the moment the model asked for", async () => {
    const tools = await buildPersonaTools({ persona: persona(), userId: 1, now: NOW });
    const result = await tools.handlers.set_reminder.run(
      { text: "到家了说一声", afterMinutes: 20 },
      { call: { id: "c1", name: "set_reminder", arguments: "{}" }, round: 1, userId: 1 },
    );
    expect(createScheduledItem).toHaveBeenCalledWith({
      userId: 1,
      personaId: 1,
      kind: "check_in",
      body: "到家了说一声",
      dueAt: new Date("2026-03-01T12:20:00Z"),
    });
    expect(result).toContain("reminder is set");
  });

  it("refuses a second one while the first has not been asked", async () => {
    countPendingCheckIns.mockResolvedValue(1);
    const tools = await buildPersonaTools({ persona: persona(), userId: 1, now: NOW });
    const result = await tools.handlers.set_reminder.run(
      { text: "还有一件", afterMinutes: 30 },
      { call: { id: "c1", name: "set_reminder", arguments: "{}" }, round: 1, userId: 1 },
    );
    expect(createScheduledItem).not.toHaveBeenCalled();
    expect(result).toContain("already holding one");
  });

  it("keeps the minutes between five and a day", async () => {
    const tools = await buildPersonaTools({ persona: persona(), userId: 1, now: NOW });
    const schema = tools.handlers.set_reminder.schema;
    expect(schema.safeParse({ text: "x", afterMinutes: REMINDER_MIN_MINUTES }).success).toBe(true);
    expect(schema.safeParse({ text: "x", afterMinutes: REMINDER_MAX_MINUTES }).success).toBe(true);
    expect(schema.safeParse({ text: "x", afterMinutes: REMINDER_MIN_MINUTES - 1 }).success).toBe(false);
    expect(schema.safeParse({ text: "x", afterMinutes: REMINDER_MAX_MINUTES + 1 }).success).toBe(false);
    expect(schema.safeParse({ text: "x", afterMinutes: 30.5 }).success).toBe(false);
    expect(schema.safeParse({ text: "   ", afterMinutes: 30 }).success).toBe(false);
  });
});

describe("send_photo", () => {
  it("hands the real photo to the caller when there is one", async () => {
    const onPhoto = vi.fn();
    const tools = await buildPersonaTools({ persona: persona(), userId: 1, now: NOW, onPhoto });
    const result = await tools.handlers.send_photo.run(
      { memoryId: 3 },
      { call: { id: "c1", name: "send_photo", arguments: "{}" }, round: 1, userId: 1 },
    );
    expect(getMemoryById).toHaveBeenCalledWith(3, 1);
    expect(listMemoryMedia).toHaveBeenCalledWith(3, 1);
    expect(onPhoto).toHaveBeenCalledWith({
      mediaId: 5,
      url: "/uploads/photos/5.jpg",
      at: new Date("2022-04-02T10:00:00Z"),
      memoryId: 3,
    });
    expect(result).toContain("sent");
  });

  it("sends nothing for another persona's memory", async () => {
    getMemoryById.mockResolvedValue({ id: 3, personaId: 2, userId: 1 });
    const onPhoto = vi.fn();
    const tools = await buildPersonaTools({ persona: persona(), userId: 1, now: NOW, onPhoto });
    const result = await tools.handlers.send_photo.run(
      { memoryId: 3 },
      { call: { id: "c1", name: "send_photo", arguments: "{}" }, round: 1, userId: 1 },
    );
    expect(onPhoto).not.toHaveBeenCalled();
    expect(result).toContain("no such memory");
  });

  it("sends nothing when the memory has no photograph", async () => {
    listMemoryMedia.mockResolvedValue([]);
    const onPhoto = vi.fn();
    const tools = await buildPersonaTools({ persona: persona(), userId: 1, now: NOW, onPhoto });
    const result = await tools.handlers.send_photo.run(
      { memoryId: 3 },
      { call: { id: "c1", name: "send_photo", arguments: "{}" }, round: 1, userId: 1 },
    );
    expect(onPhoto).not.toHaveBeenCalled();
    expect(result).toContain("no photograph");
  });
});

describe("get_weather", () => {
  it("answers with the same lookup the header uses", async () => {
    const tools = await buildPersonaTools({ persona: persona(weatherOn), userId: 1, now: NOW });
    const result = await tools.handlers.get_weather.run(
      {},
      { call: { id: "c1", name: "get_weather", arguments: "{}" }, round: 1, userId: 1 },
    );
    expect(fetchWeather).toHaveBeenCalledWith(weatherOn.ldr.city);
    expect(result).toContain("上海");
    expect(result).toContain("12");
    expect(result).toContain("overcast");
  });

  it("says so when the lookup fails, instead of inventing weather", async () => {
    fetchWeather.mockResolvedValue(null);
    const tools = await buildPersonaTools({ persona: persona(weatherOn), userId: 1, now: NOW });
    const result = await tools.handlers.get_weather.run(
      {},
      { call: { id: "c1", name: "get_weather", arguments: "{}" }, round: 1, userId: 1 },
    );
    expect(result).toContain("could not be read");
  });
});
