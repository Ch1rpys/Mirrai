import { readFileSync, readdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const { uploadRoot } = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const pathMod = require("node:path") as typeof import("node:path");
  return { uploadRoot: mkdtempSync(pathMod.join(tmpdir(), "mirrai-import-up-")) };
});

const authenticateRequest = vi.fn();
const getPersonaById = vi.fn();
const createPersonaFile = vi.fn();
const startImport = vi.fn();

vi.mock("./_core/auth", () => ({
  authenticateRequest: (...a: unknown[]) => authenticateRequest(...a),
}));

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createPersonaFile: (...a: unknown[]) => createPersonaFile(...a),
}));

vi.mock("./importers/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./importers/index")>();
  return {
    ...actual,
    startImport: (...a: unknown[]) => startImport(...a),
  };
});

vi.mock("./_core/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/env")>();
  return {
    ...actual,
    ENV: { ...actual.ENV, uploadDir: uploadRoot },
  };
});

vi.mock("./_core/rate-limit", () => {
  const RATE_LIMITS = {
    upload: { name: "upload", limit: 20, windowMs: 3_600_000, scope: "user" },
  };
  return {
    RATE_LIMITS,
    rateLimiter: {
      check: vi.fn(() => ({ allowed: true, retryAfterMs: 0, remaining: 19 })),
    },
    resolveRateLimitKey: vi.fn(() => "user:7"),
    getClientIp: vi.fn(() => "127.0.0.1"),
  };
});

import { registerImportUploadRoute } from "./importers/upload-route";

const CHAT = [
  "[2022-03-01 20:00:00] 小满：在吗",
  "[2022-03-01 20:00:05] 阿树：在的",
].join("\n");

let server: Server;
let baseUrl: string;

function startApp(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    registerImportUploadRoute(app);
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function uploadUrl(personaId: number, name: string): string {
  const params = new URLSearchParams({ personaId: String(personaId), name });
  return `${baseUrl}/api/import/upload?${params.toString()}`;
}

describe("PUT /api/import/upload", () => {
  const previousMax = process.env.MAX_IMPORT_BYTES;

  beforeEach(async () => {
    delete process.env.MAX_IMPORT_BYTES;
    authenticateRequest.mockReset();
    getPersonaById.mockReset();
    createPersonaFile.mockReset();
    startImport.mockReset();
    authenticateRequest.mockResolvedValue({ id: 7, username: "tester" });
    getPersonaById.mockResolvedValue({ id: 5, userId: 7, name: "小满" });
    createPersonaFile.mockResolvedValue(42);
    startImport.mockResolvedValue({ status: "done", written: 2 });
    await startApp();
  });

  afterEach(async () => {
    if (previousMax == null) delete process.env.MAX_IMPORT_BYTES;
    else process.env.MAX_IMPORT_BYTES = previousMax;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const name of readdirSync(uploadRoot)) {
      rmSync(path.join(uploadRoot, name), { recursive: true, force: true });
    }
  });

  afterAll(() => {
    rmSync(uploadRoot, { recursive: true, force: true });
  });

  it("rejects an unauthenticated request", async () => {
    authenticateRequest.mockRejectedValue(new Error("no session"));
    const res = await fetch(uploadUrl(5, "chat.txt"), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: CHAT,
    });
    expect(res.status).toBe(401);
    expect(createPersonaFile).not.toHaveBeenCalled();
    expect(startImport).not.toHaveBeenCalled();
  });

  it("does not write a file for somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    const res = await fetch(uploadUrl(5, "chat.txt"), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: CHAT,
    });
    expect(res.status).toBe(404);
    expect(createPersonaFile).not.toHaveBeenCalled();
    expect(readdirSync(uploadRoot)).toEqual([]);
  });

  it("refuses a request over the size limit", async () => {
    process.env.MAX_IMPORT_BYTES = "32";
    const res = await fetch(uploadUrl(5, "chat.txt"), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.alloc(80, 1),
    });
    expect(res.status).toBe(413);
    expect(createPersonaFile).not.toHaveBeenCalled();
    expect(readdirSync(uploadRoot)).toEqual([]);
  });

  it("stores the bytes, creates the persona_files row, and starts the import", async () => {
    const res = await fetch(uploadUrl(5, "chat.txt"), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: CHAT,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fileId?: number; fileUrl?: string };
    expect(body.fileId).toBe(42);
    expect(body.fileUrl).toMatch(/^\/uploads\/personas\/7\/5\//);
    expect(createPersonaFile).toHaveBeenCalledTimes(1);
    const row = createPersonaFile.mock.calls[0][0] as {
      personaId: number;
      userId: number;
      fileType: string;
      originalName: string;
      fileKey: string;
      fileSize: number;
    };
    expect(row).toMatchObject({
      personaId: 5,
      userId: 7,
      fileType: "chat_export",
      originalName: "chat.txt",
      fileSize: Buffer.byteLength(CHAT),
    });
    const abs = path.join(uploadRoot, row.fileKey);
    expect(readFileSync(abs, "utf8")).toBe(CHAT);
    expect(startImport).toHaveBeenCalledWith({
      fileId: 42,
      userId: 7,
      locale: "zh",
    });
  });
});
