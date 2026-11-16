import { copy } from "@shared/copy";
import { blockHeaderRatio, looksLikeJson, looksLikeMht, looksLikeSqlite, looksLikeXml, looksLikeZip } from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult } from "../types";
import { parseNameTimeBlocks, type BlockHeader } from "./blocks";

/**
 * Official QQ message manager TXT: `YYYY-MM-DD H:mm:ss nickname` then the body.
 * Non-text bodies use the shared placeholders in `parseTextPlaceholder`.
 */
const HEADER = /^(\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}:\d{2})\s+(.+)$/;

export function isQqTxtHeader(line: string): boolean {
  const match = HEADER.exec(line.trim());
  if (!match) return false;
  if (/[:：]/.test(match[2])) return false;
  return true;
}

function matchHeader(line: string): BlockHeader | null {
  const match = HEADER.exec(line.trim());
  if (!match) return null;
  const speaker = match[2].trim();
  if (/[:：]/.test(speaker)) return null;
  return { time: match[1], speaker };
}

/** i18n:allow-input — QQ export preamble labels, not shown. */
function isPreamble(line: string): boolean {
  if (/^=+$/.test(line)) return true;
  if (line.startsWith("消息记录") || line.startsWith("消息分组") || line.startsWith("消息对象")) {
    return true;
  }
  return false;
}

export async function parseQqTxt(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  return parseNameTimeBlocks(text, {
    timeZone: options.timeZone,
    matchHeader,
    isPreamble,
  });
}

function detectQqTxt(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  if (looksLikeJson(source.text) || looksLikeXml(source.text) || looksLikeMht(source.text)) {
    return null;
  }
  const head = source.text.slice(0, 800);
  const hasQqBanner = /消息记录|消息对象:|消息对象：/.test(head);
  if (!hasQqBanner) return null;
  const confidence = blockHeaderRatio(source.text, isQqTxtHeader);
  if (confidence < 0.3) return null;
  return { id: "qq-txt", confidence: Math.max(confidence, 0.85) };
}

export const qqTxtImporter: Importer = {
  id: "qq-txt",
  label: {
    zh: copy("zh", "import.format.qqTxt"),
    en: copy("en", "import.format.qqTxt"),
  },
  source: "qq",
  detect: detectQqTxt,
  parse(source, options) {
    return parseQqTxt(source.text, options);
  },
};
