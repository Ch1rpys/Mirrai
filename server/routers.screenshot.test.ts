import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const resolveProviderForPurpose = vi.fn();
const readScreenshotPages = vi.fn();
const importRecords = vi.fn();
const afterRecordsChanged = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("./llm/user-provider", () => ({
  resolveProviderForPurpose: (...a: unknown[]) => resolveProviderForPurpose(...a),
}));

vi.mock("./importers/screenshot", () => ({
  readScreenshotPages: (...a: unknown[]) => readScreenshotPages(...a),
}));

vi.mock("./collectors/db-store", () => ({
  importRecords: (...a: unknown[]) => importRecords(...a),
}));

vi.mock("./_core/style-profile", () => ({
  afterRecordsChanged: (...a: unknown[]) => afterRecordsChanged(...a),
}));

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

const visionProvider = {
  name: "OpenAI",
  capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
};

describe("importing a chat from screenshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    resolveProviderForPurpose.mockResolvedValue(visionProvider);
    readScreenshotPages.mockResolvedValue({
      pages: [
        [
          { side: "center", time: "12:30" },
          { side: "left", text: "在吗" },
          { side: "right", text: "在" },
        ],
      ],
      failures: [],
    });
    importRecords.mockResolvedValue(2);
    afterRecordsChanged.mockResolvedValue(undefined);
  });

  it("reads without writing anything", async () => {
    const result = await appRouter.createCaller(ctxFor()).import.screenshotPreview({
      personaId: 5,
      date: "2024-06-01",
      images: [{ name: "a.jpg", base64: "AAAA" }],
    });
    expect(result.rows.map((row) => row.content)).toEqual(["在吗", "在"]);
    expect(result.rows[0]?.role).toBe("assistant");
    expect(result.rows[0]?.at).toBe("2024-06-01T04:30:00.000Z");
    expect(result.providerName).toBe("OpenAI");
    expect(importRecords).not.toHaveBeenCalled();
  });

  it("refuses a preview when no model can see", async () => {
    resolveProviderForPurpose.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor()).import.screenshotPreview({
        personaId: 5,
        images: [{ name: "a.jpg", base64: "AAAA" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(readScreenshotPages).not.toHaveBeenCalled();
  });

  it("writes the rows the user confirmed with the screenshot source", async () => {
    const result = await appRouter.createCaller(ctxFor()).import.screenshotConfirm({
      personaId: 5,
      rows: [
        {
          role: "assistant",
          content: "在吗",
          kind: "text",
          at: "2024-06-01T04:30:00.000Z",
          timeApprox: true,
        },
        { role: "user", content: "在", kind: "text", at: "2024-06-01T04:30:01.000Z" },
      ],
    });
    expect(result.written).toBe(2);
    const call = importRecords.mock.calls[0]![0] as any;
    expect(call.source).toBe("screenshot");
    expect(call.records[0]).toMatchObject({
      role: "assistant",
      content: "在吗",
      timestamp: new Date("2024-06-01T04:30:00.000Z"),
      // The approximate time travels with the record, not just the preview.
      meta: { timeApprox: true },
    });
    expect(call.records[1]?.meta).toBeUndefined();
    expect(afterRecordsChanged).toHaveBeenCalledWith({ personaId: 5, userId: 1, added: 2 });
  });

  it("previews pasted public posts without a provider", async () => {
    const result = await appRouter.createCaller(ctxFor()).import.momentsPreview({
      personaId: 5,
      text: "今天去看了海。\n\n周末在家。",
      date: "2024-06-01",
    });
    expect(result.posts.map((post) => post.text)).toEqual(["今天去看了海。", "周末在家。"]);
    expect(result.posts[0]?.at).toBe("2024-06-01T04:00:00.000Z");
    expect(resolveProviderForPurpose).not.toHaveBeenCalled();
    expect(importRecords).not.toHaveBeenCalled();
  });

  it("writes confirmed public posts with the public register", async () => {
    await appRouter.createCaller(ctxFor()).import.momentsConfirm({
      personaId: 5,
      posts: [{ text: "今天去看了海。", at: "2024-06-01T04:00:00.000Z" }],
    });
    const call = importRecords.mock.calls[0]![0] as any;
    expect(call.source).toBe("moments");
    expect(call.records[0]).toMatchObject({
      role: "assistant",
      content: "今天去看了海。",
      meta: { register: "public" },
    });
  });

  it("does not write to somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor()).import.screenshotConfirm({
        personaId: 5,
        rows: [{ role: "assistant", content: "在吗", kind: "text", at: null }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(importRecords).not.toHaveBeenCalled();
  });
});
