import { copy } from "@shared/copy";
import { blockHeaderRatio, looksLikeJson, looksLikeMht, looksLikeSqlite, looksLikeXml, looksLikeZip } from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult } from "../types";
import { parseNameTimeBlocks, type BlockHeader } from "./blocks";

/**
 * WeChatMsg TxtExporter: `YYYY-MM-DD HH:mm:ss nickname` then the body.
 * Non-text bodies use the shared placeholders in `parseTextPlaceholder`.
 */
const HEADER = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\s+(.+))?$/;

export function isWechatTxt2LineHeader(line: string): boolean {
  const match = HEADER.exec(line.trim());
  if (!match) return false;
  // A generic-line row puts the speaker and a colon on this same line.
  const name = (match[2] ?? "").trim();
  if (/[:：]/.test(name)) return false;
  return true;
}

function matchHeader(line: string): BlockHeader | null {
  const match = HEADER.exec(line.trim());
  if (!match) return null;
  const name = (match[2] ?? "").trim();
  if (/[:：]/.test(name)) return null;
  return {
    time: match[1],
    speaker: name || "system",
    kind: name ? "text" : "system",
  };
}

export async function parseWechatTxt2Line(
  text: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  return parseNameTimeBlocks(text, {
    timeZone: options.timeZone,
    matchHeader,
  });
}

function detectWechatTxt2Line(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  if (looksLikeJson(source.text) || looksLikeXml(source.text) || looksLikeMht(source.text)) {
    return null;
  }
  const confidence = blockHeaderRatio(source.text, isWechatTxt2LineHeader);
  if (confidence < 0.3) return null;
  return { id: "wechat-txt-2line", confidence };
}

export const wechatTxt2LineImporter: Importer = {
  id: "wechat-txt-2line",
  label: {
    zh: copy("zh", "import.format.wechatTxt2Line"),
    en: copy("en", "import.format.wechatTxt2Line"),
  },
  source: "wechat_export",
  detect: detectWechatTxt2Line,
  parse(source, options) {
    return parseWechatTxt2Line(source.text, options);
  },
};
