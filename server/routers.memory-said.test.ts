import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const getMemoryById = vi.fn();
const updateMemory = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMemoryById: (...a: unknown[]) => getMemoryById(...a),
  updateMemory: (...a: unknown[]) => updateMemory(...a),
}));

import { appRouter } from "./routers";

function ctxFor(): TrpcContext {
  return {
    user: { id: 1, name: "Sample", tokenVersion: 0, locale: "zh" },
    locale: "zh",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("confirming a said memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 1, userId: 1, name: "小A" });
  });

  it("marks it as theirs and written by hand", async () => {
    getMemoryById.mockResolvedValue({ id: 7, subject: "said", source: "chat" });
    updateMemory.mockResolvedValue({ id: 7, subject: "them", source: "manual" });

    const result = await appRouter.createCaller(ctxFor()).memory.update({
      id: 7,
      subject: "them",
    });

    expect(result.success).toBe(true);
    expect(updateMemory).toHaveBeenCalledWith(7, 1, expect.objectContaining({
      subject: "them",
      source: "manual",
    }));
  });

  it("does not rewrite the source of a memory that was already theirs", async () => {
    getMemoryById.mockResolvedValue({ id: 7, subject: "them", source: "chat" });
    updateMemory.mockResolvedValue({ id: 7, subject: "them", source: "chat" });

    await appRouter.createCaller(ctxFor()).memory.update({
      id: 7,
      subject: "them",
    });

    expect(updateMemory).toHaveBeenCalledWith(7, 1, expect.objectContaining({ subject: "them" }));
    expect(updateMemory.mock.calls[0][2]).not.toHaveProperty("source");
  });
});
