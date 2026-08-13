/**
 * Pipeline budgets (one place, tuned for a 1M-token / 384K-max-output model).
 */
export const DEEP_MAX_TOKENS = 65_536;
export const TITLE_ESSENCE_MAX_TOKENS = 4_096;
export const SCREEN_MAX_TOKENS = 1_024;
export const SYNTH_MAX_TOKENS = 16_384;
/** Merge-candidate pass output bound (defensive). */
export const MERGE_MAX_TOKENS = 2_048;
/** KB context budget shared by the deep call's relation index and the dedup screen's history slice (~75k tokens at ~4 chars/token). */
export const KB_BUDGET_CHARS = 300_000;
/** Classification input budget for the topic tree (~25k tokens). */
export const TOPIC_TREE_BUDGET_CHARS = 100_000;
