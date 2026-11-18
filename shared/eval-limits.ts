/**
 * How many of their lines a held-out set is allowed to start from.
 *
 * One line leaves nothing to fit the n-gram model on. The cutter and
 * the material report read this same number.
 */
export const EVAL_MIN_ASSISTANT_LINES = 2;

/** Four-way rerank will not run on fewer of their text lines than this. */
export const RERANK_MIN_ASSISTANT_LINES = 40;
