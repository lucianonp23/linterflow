/**
 * Intent-based (assert) suite for the 8 files whose behaviour changed after treatment.
 *
 * Unlike the golden-master suite, the expected values here are WRITTEN, from the generation
 * prompt (corpus/prompts/<file>.prompt.txt), the contract the file itself declares (types,
 * enums, messages) and the rules of the domain. Every test runs unchanged on both arms:
 *
 *   ARM=corpus      npx jest --config behaviour/intent/jest.intent.config.js
 *   ARM=corpus-run  npx jest --config behaviour/intent/jest.intent.config.js
 *
 * Comparing pass/fail per test across the two arms gives the 2x2 classification
 * (preserved / regression / fixed / inherited) in behaviour/intent/INTENT_REPORT.md.
 */
const path = require('path');
const base = require('../jest.config.js');

process.env.TZ = 'UTC';
const ARM = process.env.ARM || 'corpus';

module.exports = {
  ...base,
  roots: ['<rootDir>/behaviour', `<rootDir>/${ARM}`],
  testRegex: 'behaviour/intent/specs/.*\\.intent\\.spec\\.ts$',
  collectCoverageFrom: undefined,
  coverageDirectory: undefined,
  coverageReporters: undefined,
};
