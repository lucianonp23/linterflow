/**
 * File-selection and clone-detection constants shared by tools that must look
 * at exactly the same code the pipeline looks at.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A measurement is only comparable with the pipeline's own numbers if it scans
 * the same files with the same clone thresholds. When those values live inline
 * at each call site they drift silently, and the drift shows up as a metric
 * that disagrees with itself.
 *
 * WHAT IT DOES NOT DO (yet)
 * -------------------------
 * `producer.service.ts` and `credits.service.ts` still carry their own copies of
 * the ignore list. They are deliberately left alone: the committed corpus
 * results were produced by that exact code, and rewriting it mid-experiment
 * would mean the artefacts in `corpus-run/` no longer correspond to the source
 * that produced them. Consolidate them after the dissertation run is closed.
 */

/**
 * Globs excluded from every pipeline scan.
 * MIRRORS the inline list in `producer.service.ts` (orchestrateFolder) and
 * `PIPELINE_IGNORE` in `credits.service.ts` — keep all three in sync.
 */
export const PIPELINE_IGNORE = [
  '**/node_modules/**',
  '**/*.d.ts',
  '**/*.spec.ts',
  '**/*.bak',
];

/**
 * jscpd thresholds. MIRRORS the options passed in `evaluator.service.ts`
 * (detectDuplications) — a project-level rate measured with different
 * thresholds than the per-file gate is not comparable with it.
 *
 * minLines 5 / minTokens 50: a clone must be at least five lines AND fifty
 * tokens, which is what keeps import blocks and short guard clauses from
 * registering as duplication.
 */
export const JSCPD_MIN_LINES = 5;
export const JSCPD_MIN_TOKENS = 50;
