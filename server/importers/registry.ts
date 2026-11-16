import { genericLineImporter } from "./formats/generic-line";
import { wechatTxt2LineImporter } from "./formats/wechat-txt-2line";
import { wechatTxtParenImporter } from "./formats/wechat-txt-paren";
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
];

export function importerById(id: ImportFormatId | string): Importer | undefined {
  return IMPORTERS.find((row) => row.id === id);
}
