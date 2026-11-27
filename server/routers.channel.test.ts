import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { ChannelAdapter } from "./channels/types";

/**
 * Channel management for every registered channel (C9.7).
 *
 * A plugin may register `plugin:<name>:<id>` (C9.7). The channel routes
 * used to accept only the five built-in ids, so a plugin channel could be
 * loaded and listed but never started or stopped. The id is now any id in
 * the registry; unknown ids are still NOT_FOUND.
 */

const start = vi.fn();
const stop = vi.fn();
const status = vi.fn();
const adapters = new Map<string, ChannelAdapter>();

function adapter(id: string): ChannelAdapter {
  return {
    id: id as ChannelAdapter["id"],
    label: `Plugin ${id}`,
    requiresCredentials: false,
    start,
    stop,
    status,
    send: vi.fn(),
  } as unknown as ChannelAdapter;
}

vi.mock("./channels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./channels")>();
  return {
    ...actual,
    listChannels: () => Array.from(adapters.values()),
    getChannelAdapter: (id: string) => adapters.get(id),
  };
});

import { appRouter } from "./routers";

function ctxFor(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
      tokenVersion: 0,
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  adapters.clear();
  adapters.set("plugin:demo:echo", adapter("plugin:demo:echo"));
  start.mockResolvedValue(undefined);
  stop.mockResolvedValue(undefined);
  status.mockResolvedValue({ channel: "plugin:demo:echo", connected: false, status: "stopped" });
});

describe("the channel routes accept a registered plugin channel", () => {
  it("lists it with its label", async () => {
    const channels = await appRouter.createCaller(ctxFor()).channel.list();
    expect(channels.map((row) => row.id)).toEqual(["plugin:demo:echo"]);
    expect(channels[0]!.label).toBe("Plugin plugin:demo:echo");
  });

  it("starts, reports and stops it", async () => {
    const api = appRouter.createCaller(ctxFor());
    await expect(api.channel.start({ channel: "plugin:demo:echo" })).resolves.toEqual({
      success: true,
    });
    expect(start).toHaveBeenCalledWith(1, "zh");
    await expect(api.channel.getStatus({ channel: "plugin:demo:echo" })).resolves.toMatchObject({
      status: "stopped",
    });
    expect(status).toHaveBeenCalledWith(1);
    await expect(api.channel.stop({ channel: "plugin:demo:echo" })).resolves.toEqual({
      success: true,
    });
    expect(stop).toHaveBeenCalledWith(1);
  });

  it("still refuses an id nobody registered", async () => {
    const api = appRouter.createCaller(ctxFor());
    await expect(api.channel.start({ channel: "plugin:missing:x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(api.channel.getStatus({ channel: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
