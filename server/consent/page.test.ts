import { describe, expect, it } from "vitest";
import {
  buildConsentPageHtml,
  CONSENT_LINK_TTL_MS,
  CONSENT_TOKEN_BYTES,
  createConsentToken,
  hashConsentToken,
  isConsentLinkExpired,
} from "./link";

describe("the consent page", () => {
  it("is one self-contained document", () => {
    const html = buildConsentPageHtml({ name: "小满" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // No external resources of any kind: no scripts, no stylesheets, no
    // fonts, no images, and no links out.
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).not.toMatch(/href=/i);
    // The style is inline, so the page reads the same offline.
    expect(html).toContain("<style>");
  });

  it("says what it is for, in both languages", () => {
    const zh = buildConsentPageHtml({ name: "小满", locale: "zh" });
    expect(zh).toContain("关于这个数字分身");
    expect(zh).toContain("不模仿你的声音");
    const en = buildConsentPageHtml({ name: "Xiaoman", locale: "en" });
    expect(en).toContain("About this digital persona");
    expect(en).toContain("it does not imitate your voice");
  });

  it("escapes the name it was given", () => {
    const html = buildConsentPageHtml({ name: `<img src=x onerror="alert(1)">&` });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;");
  });

  it("marks the page as not for indexing", () => {
    expect(buildConsentPageHtml({ name: "小满" })).toContain('name="robots" content="noindex"');
  });
});

describe("the consent token", () => {
  it("is 32 random bytes and only its hash is looked up", () => {
    const token = createConsentToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(CONSENT_TOKEN_BYTES).toBe(32);
    expect(token).toHaveLength(CONSENT_TOKEN_BYTES * 2);
    expect(hashConsentToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashConsentToken(token)).not.toBe(token);
    expect(createConsentToken()).not.toBe(token);
  });

  it("expires thirty days after it was made", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date(now.getTime() + CONSENT_LINK_TTL_MS);
    expect(CONSENT_LINK_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(isConsentLinkExpired(expiresAt.toISOString(), now)).toBe(false);
    expect(isConsentLinkExpired(expiresAt.toISOString(), new Date(expiresAt.getTime() + 1))).toBe(true);
  });

  it("treats a missing or unreadable date as expired", () => {
    expect(isConsentLinkExpired(null)).toBe(true);
    expect(isConsentLinkExpired(undefined)).toBe(true);
    expect(isConsentLinkExpired("not a date")).toBe(true);
  });
});
