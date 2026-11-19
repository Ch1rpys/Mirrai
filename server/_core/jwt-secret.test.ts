import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveJwtSecret } from "./env";

describe("resolveJwtSecret", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("trims surrounding whitespace from a valid secret", () => {
    process.env.JWT_SECRET = "   super-secure-production-secret-12345   \n";
    expect(resolveJwtSecret()).toBe("super-secure-production-secret-12345");
  });

  it("rejects known insecure placeholders in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "dev-secret-change-me";
    expect(() => resolveJwtSecret()).toThrow("must not be a known placeholder");

    process.env.JWT_SECRET = "your-secret-key-change-me";
    expect(() => resolveJwtSecret()).toThrow("must not be a known placeholder");
  });

  it("rejects secrets that are too short in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "too-short";
    expect(() => resolveJwtSecret()).toThrow("minimum 16 characters required");
  });

  it("throws when missing in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    expect(() => resolveJwtSecret()).toThrow("JWT_SECRET is required in production");
  });

  it("falls back to default with a warning in development when unset", () => {
    process.env.NODE_ENV = "development";
    delete process.env.JWT_SECRET;
    expect(resolveJwtSecret()).toBe("dev-secret-change-me");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("JWT_SECRET is not set"));
  });
});
