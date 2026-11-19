/**
 * What the videos contribute to the analysis text (B7.10).
 *
 * The words are material: they are fenced, never spliced into the
 * instructions. The count of videos that were over the limit is app
 * text, because the user has to know the report is partial.
 */
import { copy } from "@shared/copy";
import type { Locale } from "@shared/copy";
import { asMaterial } from "./material";

export interface VideoMaterialNotes {
  transcripts: string[];
  skipped: number;
}

export function appendVideoMaterial(
  analysis: string,
  notes: VideoMaterialNotes,
  locale: Locale,
): string {
  let out = analysis;
  if (notes.transcripts.length > 0) {
    out +=
      "\n\n" +
      copy(locale, "skillPrompts.pipeline.videoTranscriptsHeading") +
      "\n" +
      notes.transcripts.map((line) => asMaterial(line, locale)).join("\n\n");
  }
  if (notes.skipped > 0) {
    out +=
      "\n\n" +
      copy(locale, "skillPrompts.pipeline.videoSkipped", { n: notes.skipped, max: 4 });
  }
  return out;
}
