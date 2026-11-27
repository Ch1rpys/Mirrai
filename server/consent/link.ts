/**
 * The consent link and the page that can be sent to the other person
 * (C10.3).
 *
 * Two ways to ask: a self-contained HTML file the owner can send, or a
 * link on this instance. Both show the same fixed text and the name of
 * the person being modelled — and nothing else. The link's token is 32
 * random bytes; the database only stores its SHA-256 hash, so a leaked
 * database cannot be turned into a working link.
 *
 * There is no account on the other side. Whatever the page returns must
 * be safe to hand to a stranger: no records, no persona data, no ids.
 */
import { createHash, randomBytes } from "node:crypto";
import { copy } from "@shared/copy";
import type { Locale } from "@shared/copy";

/** 32 bytes, per the manual. */
export const CONSENT_TOKEN_BYTES = 32;

/** How long a link works. */
export const CONSENT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A fresh token. Only its hash is stored. */
export function createConsentToken(): string {
  return randomBytes(CONSENT_TOKEN_BYTES).toString("hex");
}

/** The lookup value stored in the persona's settings. */
export function hashConsentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Whether a link has run out. */
export function isConsentLinkExpired(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true;
  const at = new Date(expiresAt);
  if (!Number.isFinite(at.getTime())) return true;
  return at.getTime() <= now.getTime();
}

/** Escapes text for HTML text and attribute positions. */
export function escapeConsentHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The page, as one self-contained HTML document.
 *
 * Everything is inline: no scripts, no stylesheets, no fonts, no images,
 * no links out. It opens on a machine with no network and shows the same
 * thing. `name` is the person being modelled, so it is escaped rather
 * than trusted — it is whatever the owner typed.
 */
export function buildConsentPageHtml(params: {
  name: string;
  locale?: Locale;
}): string {
  const locale = params.locale ?? "zh";
  const name = params.name ?? "";
  const lead = copy(locale, "consentPage.lead", { name });
  const sections: Array<{ heading: string; body: string }> = [
    { heading: copy(locale, "consentPage.whatHeading"), body: copy(locale, "consentPage.whatBody") },
    { heading: copy(locale, "consentPage.dataHeading"), body: copy(locale, "consentPage.dataBody") },
    { heading: copy(locale, "consentPage.neverHeading"), body: copy(locale, "consentPage.neverBody") },
    { heading: copy(locale, "consentPage.noHeading"), body: copy(locale, "consentPage.noBody") },
  ];
  const body = sections
    .map(
      (section) =>
        `<section>\n<h2>${escapeConsentHtml(section.heading)}</h2>\n<p>${escapeConsentHtml(section.body)}</p>\n</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escapeConsentHtml(copy(locale, "consentPage.title"))}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 2.5rem 1.25rem; font-family: system-ui, -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif; line-height: 1.7; color: #1f2328; background: #fbfaf8; }
main { max-width: 40rem; margin: 0 auto; }
h1 { font-size: 1.35rem; line-height: 1.4; margin: 0 0 1rem; }
h2 { font-size: 1rem; margin: 1.75rem 0 0.4rem; }
p { margin: 0; }
footer { margin-top: 2.5rem; font-size: 0.8rem; color: #6b7280; }
@media (prefers-color-scheme: dark) { body { color: #e6e6e6; background: #16181c; } footer { color: #9ca3af; } }
</style>
</head>
<body>
<main>
<h1>${escapeConsentHtml(copy(locale, "consentPage.title"))}</h1>
<p>${escapeConsentHtml(lead)}</p>
${body}
<footer>${escapeConsentHtml(copy(locale, "consentPage.footer"))}</footer>
</main>
</body>
</html>
`;
}
