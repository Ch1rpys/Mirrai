/**
 * MIME HTML (`.mht`) unpacking used by QQ's message manager.
 *
 * Boundary split and quoted-printable are enough for the HTML part;
 * images stay as `cid:` references and are left for C1.3.
 */
function unescapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeQuotedPrintable(body: string): string {
  const unfolded = body.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i++) {
    if (unfolded[i] === "=" && /[0-9A-Fa-f]{2}/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    bytes.push(unfolded.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString("utf8");
}

function partBody(part: string): { headers: string; body: string } {
  const split = part.search(/\r?\n\r?\n/);
  if (split < 0) return { headers: part, body: "" };
  return { headers: part.slice(0, split), body: part.slice(split).replace(/^\r?\n\r?\n/, "") };
}

export function extractHtmlFromMht(text: string): string {
  const boundary = text.match(/boundary="?([^"\s;]+)"?/i)?.[1];
  if (!boundary) {
    const htmlStart = text.search(/<html/i);
    return htmlStart >= 0 ? text.slice(htmlStart) : text;
  }
  const parts = text.split(new RegExp(`--${unescapeRegex(boundary)}`));
  for (const part of parts) {
    if (!/Content-Type:\s*text\/html/i.test(part)) continue;
    const { headers, body } = partBody(part);
    if (/quoted-printable/i.test(headers)) return decodeQuotedPrintable(body);
    if (/base64/i.test(headers)) {
      return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
    }
    return body;
  }
  return text;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
