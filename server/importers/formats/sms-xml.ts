/**
 * Android SMS Backup & Restore XML.
 *
 * Checked 2026-11-16 against SyncTech's field reference
 * (https://www.synctech.com.au/sms-backup-restore/fields-in-xml-backup-files/):
 * `<sms address date type body contact_name />`. type 1 received, 2 sent.
 * `date` is Unix milliseconds.
 */
import { copy } from "@shared/copy";
import type { ParsedRecord } from "@shared/records";
import {
  cappedWarnings,
  collectSpeakers,
  looksLikeSqlite,
  looksLikeZip,
  parseUnixTime,
  yieldToEventLoop,
} from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult, ParseWarning } from "../types";

function decodeXml(value: string): string {
  return value
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : "";
}

export async function parseSmsXml(text: string, _options: ParseOptions = {}): Promise<ParseResult> {
  const records = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  const tags = text.match(/<sms\b[^>]*\/?>/gi) ?? [];
  for (let i = 0; i < tags.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const tag = tags[i]!;
    const type = attr(tag, "type");
    const body = attr(tag, "body");
    const contact = attr(tag, "contact_name");
    const address = attr(tag, "address");
    const date = attr(tag, "date");
    if (type !== "1" && type !== "2") {
      skipped += 1;
      continue;
    }
    if (!body) {
      skipped += 1;
      warnings.push({ code: "skipped_line", lineNo: i + 1 });
      continue;
    }
    const speaker = (contact && contact !== "(Unknown)" ? contact : address).trim() || "sms";
    records.push({
      speaker,
      fromMe: type === "2",
      content: body,
      timestamp: parseUnixTime(Number(date)),
      kind: "text" as const,
      lineNo: i + 1,
    });
  }
  return {
    records,
    speakers: collectSpeakers(records),
    warnings: cappedWarnings(warnings),
    skipped,
  };
}

function detectSmsXml(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  const head = source.text.slice(0, 2000);
  if (!/<smses\b/i.test(head) && !/<sms\b/i.test(head)) return null;
  const tags = source.text.match(/<sms\b[^>]*\/?>/gi) ?? [];
  if (tags.length === 0) return null;
  let hits = 0;
  for (const tag of tags.slice(0, 30)) {
    if (/type="[12]"/.test(tag) && /date="\d+"/.test(tag)) hits += 1;
  }
  const sample = Math.min(tags.length, 30);
  const confidence = hits / sample;
  if (confidence < 0.3) return null;
  return { id: "sms-xml", confidence };
}

export const smsXmlImporter: Importer = {
  id: "sms-xml",
  label: {
    zh: copy("zh", "import.format.smsXml"),
    en: copy("en", "import.format.smsXml"),
  },
  source: "sms",
  detect: detectSmsXml,
  parse(source, options) {
    return parseSmsXml(source.text, options);
  },
};
