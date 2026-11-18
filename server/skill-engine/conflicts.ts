/**
 * Conflict mining for the skill engine.
 *
 * The measurement itself is a pure function of labelled scenes; this
 * file is the handbook path into that function.
 */
export {
  mineConflictEpisodes,
  mineConflicts,
  summarizeConflicts,
  type ConflictEpisode,
  type ConflictProfile,
  type ConflictScene,
} from "@shared/conflicts";
