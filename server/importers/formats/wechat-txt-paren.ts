import { copy } from "@shared/copy";
import { blockHeaderRatio, looksLikeJson, looksLikeMht, looksLikeSqlite, looksLikeXml, looksLikeZip } from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult } from "../types";
import { parseNameTimeBlocks, type BlockHeader } from "./blocks";

/**
 * `昵称 (YYYY-MM-DD HH:mm:ss):` then the body, on the same line or the
 * next. WeChatDumpText writes the same shape without the trailing colon.
 */
const HEADER = /^(.+?)\s+\((\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2})\):?\s*(.*)$/;

export function isWechatTxtParenHeader(line: string): boolean {
  return HEADER.test(line.trim());
}

function matchHeader(line: string): BlockHeader | null {
  const match = HEADER.exec(line.trim());
  if (!match) return null;
  const speaker = match[1].trim();
  if (!speaker) return null;
  const content = match[3].trim();
  return { time: match[2], speaker, content: content || undefined };
}

export async function parseWechatTxtParen(
  text: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  return parseNameTimeBlocks(text, {
    timeZone: options.timeZone,
    matchHeader,
  });
}

function detectWechatTxtParen(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  if (looksLikeJson(source.text) || looksLikeXml(source.text) || looksLikeMht(source.text)) {
    return null;
  }
  const confidence = blockHeaderRatio(source.text, isWechatTxtParenHeader);
  if (confidence < 0.3) return null;
  return { id: "wechat-txt-paren", confidence };
}

export const wechatTxtParenImporter: Importer = {
  id: "wechat-txt-paren",
  label: {
    zh: copy("zh", "import.format.wechatTxtParen"),
    en: copy("en", "import.format.wechatTxtParen"),
  },
  source: "wechat_export",
  detect: detectWechatTxtParen,
  parse(source, options) {
    return parseWechatTxtParen(source.text, options);
  },
};
