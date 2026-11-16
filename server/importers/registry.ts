import { genericLineImporter } from "./formats/generic-line";
import type { ImportFormatId, Importer } from "./types";

/**
 * The importers startImport and the wizard can actually run.
 *
 * A format is not listed here until its parser, sample, and README
 * section exist. The wizard only offers what this array contains.
 */
export const IMPORTERS: Importer[] = [genericLineImporter];

export function importerById(id: ImportFormatId | string): Importer | undefined {
  return IMPORTERS.find((row) => row.id === id);
}
