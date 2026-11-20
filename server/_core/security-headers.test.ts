import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

/**
 * The app serves the user's own files from its own origin: chat logs,
 * photos, synthesised speech. So the browser's own decisions about what
 * a response is matter a great deal — and the app was not making any of
 * them.
 */
function run() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  securityHeaders({} as Request, res, next);
  return { headers, next };
}

describe("the headers every response carries", () => {
  it("tells the browser not to sniff the content", () => {
    // A file named `photo.jpg` can hold anything. Without this the
    // browser may decide that it is really HTML — and it would run in
    // the app's own origin.
    const { headers, next } = run();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(next).toHaveBeenCalled();
  });

  it("keeps other sites from framing the app", () => {
    const { headers } = run();
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  it("does not leak the address of the page in the referrer", () => {
    const { headers } = run();
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("never lets an uploaded file be a script", () => {
    const policy = contentSecurityPolicy();
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
  });

  it("allows the styles React sets inline", () => {
    // Without this the app loses every dynamic style it has.
    expect(contentSecurityPolicy()).toContain("style-src 'self' 'unsafe-inline'");
  });
});

describe("the map basemap and the content policy", () => {
  it("has no external image origin when MAP_TILE_URL is not set", () => {
    const previous = process.env.MAP_TILE_URL;
    delete process.env.MAP_TILE_URL;
    try {
      expect(contentSecurityPolicy()).toContain("img-src 'self' data: blob:;");
      expect(contentSecurityPolicy()).not.toContain("https://tiles.example.com");
    } finally {
      if (previous === undefined) delete process.env.MAP_TILE_URL;
      else process.env.MAP_TILE_URL = previous;
    }
  });

  it("allows exactly the configured tile origin", () => {
    const previous = process.env.MAP_TILE_URL;
    process.env.MAP_TILE_URL = "https://tiles.example.com/{z}/{x}/{y}.png";
    try {
      const policy = contentSecurityPolicy();
      expect(policy).toContain("https://tiles.example.com");
      expect(policy).not.toContain("{z}");
    } finally {
      if (previous === undefined) delete process.env.MAP_TILE_URL;
      else process.env.MAP_TILE_URL = previous;
    }
  });
});
