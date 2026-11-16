/**
 * QQ message-manager MHT.
 *
 * Checked 2026-11-16 against third-party converters that unpack the
 * official manager's MIME HTML
 * ([NnWinter/QQ_Mht_Message_To_Html](https://github.com/NnWinter/QQ_Mht_Message_To_Html),
 * [Ylsssq926/relic.skill qq_parser](https://github.com/Ylsssq926/relic.skill/blob/main/scripts/qq_parser.py)):
 * headers are `昵称(QQ号) YYYY-MM-DD H:mm:ss` (12-hour `上午`/`下午`
 * allowed), then the body until the next header. Tencent does not
 * publish the HTML schema; this is the shape those tools agree on.
 */
import { copy } from "@shared/copy";
import { blockHeaderRatio, looksLikeMht, looksLikeSqlite, looksLikeZip } from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult } from "../types";
import { parseNameTimeBlocks, type BlockHeader } from "./blocks";
import { extractHtmlFromMht, htmlToText } from "./mht";

// i18n:allow-input — date particles in a QQ MHT header, not shown.
const TIME = "(\\d{4}[-/年]\\d{1,2}[-/月]\\d{1,2}(?:日)?\\s+(?:上午|下午)?\\s*\\d{1,2}:\\d{2}(?::\\d{2})?)";
const WITH_ID = new RegExp(`^(.+?)\\s*[（(]([^)）]+)[)）]\\s+${TIME}$`);
const NAME_TIME = new RegExp(`^(.+?)\\s+${TIME}$`);

export function isQqMhtHeader(line: string): boolean {
  return matchHeader(line) != null;
}

function matchHeader(line: string): BlockHeader | null {
  const trimmed = line.trim();
  const withId = WITH_ID.exec(trimmed);
  if (withId) return { speaker: withId[1].trim(), time: withId[3] };
  const named = NAME_TIME.exec(trimmed);
  if (!named) return null;
  const speaker = named[1].trim();
  if (!speaker || /[:：]/.test(speaker) || /^\d{4}/.test(speaker)) return null;
  return { speaker, time: named[2] };
}

/** i18n:allow-input — QQ export preamble labels, not shown. */
function isPreamble(line: string): boolean {
  if (/^=+$/.test(line)) return true;
  if (line.startsWith("消息记录") || line.startsWith("消息分组") || line.startsWith("消息对象")) {
    return true;
  }
  return false;
}

export function mhtPlainText(sourceText: string): string {
  return htmlToText(extractHtmlFromMht(sourceText));
}

export async function parseQqMht(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  return parseNameTimeBlocks(mhtPlainText(text), {
    timeZone: options.timeZone,
    matchHeader,
    isPreamble,
  });
}

function detectQqMht(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  if (!looksLikeMht(source.text) && !/<html/i.test(source.text.slice(0, 400))) return null;
  const plain = mhtPlainText(source.text);
  const confidence = blockHeaderRatio(plain, isQqMhtHeader);
  if (confidence < 0.3) return null;
  return { id: "qq-mht", confidence: Math.max(confidence, looksLikeMht(source.text) ? 0.85 : 0.7) };
}

export const qqMhtImporter: Importer = {
  id: "qq-mht",
  label: {
    zh: copy("zh", "import.format.qqMht"),
    en: copy("en", "import.format.qqMht"),
  },
  source: "qq",
  detect: detectQqMht,
  parse(source, options) {
    return parseQqMht(source.text, options);
  },
};
