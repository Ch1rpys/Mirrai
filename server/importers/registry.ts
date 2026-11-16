import { genericLineImporter } from "./formats/generic-line";
import { wechatTxt2LineImporter } from "./formats/wechat-txt-2line";
import { wechatTxtParenImporter } from "./formats/wechat-txt-paren";
import { wechatCsvImporter } from "./formats/wechat-csv";
import { wechatJsonImporter } from "./formats/wechat-json";
import { qqTxtImporter } from "./formats/qq-txt";
import { qqMhtImporter } from "./formats/qq-mht";
import { telegramJsonImporter } from "./formats/telegram-json";
import { whatsappTxtImporter } from "./formats/whatsapp-txt";
import { lineTxtImporter } from "./formats/line-txt";
import { kakaoTxtImporter } from "./formats/kakao-txt";
import { metaJsonImporter } from "./formats/meta-json";
import { discordJsonImporter } from "./formats/discord-json";
import { smsXmlImporter } from "./formats/sms-xml";
import { imessageDbImporter } from "./formats/imessage-db";
import type { ImportFormatId, Importer } from "./types";

/**
 * The importers startImport and the wizard can actually run.
 *
 * A format is not listed here until its parser, sample, and README
 * section exist. The wizard only offers what this array contains.
 */
export const IMPORTERS: Importer[] = [
  genericLineImporter,
  wechatTxt2LineImporter,
  wechatTxtParenImporter,
  wechatCsvImporter,
  wechatJsonImporter,
  qqTxtImporter,
  qqMhtImporter,
  telegramJsonImporter,
  whatsappTxtImporter,
  lineTxtImporter,
  kakaoTxtImporter,
  metaJsonImporter,
  discordJsonImporter,
  smsXmlImporter,
  imessageDbImporter,
];

export function importerById(id: ImportFormatId | string): Importer | undefined {
  return IMPORTERS.find((row) => row.id === id);
}
