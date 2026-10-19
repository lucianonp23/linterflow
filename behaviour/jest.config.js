/**
 * Behavioural-preservation suite (post-hoc, outside the LinterFlow loop).
 *
 *   ARM=corpus      BEHAVIOUR_MODE=record   -> records golden outputs from the ORIGINAL files
 *   ARM=corpus      (default mode: check)   -> re-runs the originals against their own golden
 *   ARM=corpus-run                          -> runs the SAME frozen cases against the refactored files
 *
 * Separate from the application's Jest config (package.json, rootDir=src) on purpose:
 * the corpus is experiment data and is never type-checked (see tsconfig.json "exclude").
 */
const path = require('path');
const fs = require('fs');

// Several files read local time (getHours, getDay, setHours). Fixed for every arm.
process.env.TZ = 'UTC';

const ARM = process.env.ARM || 'corpus';
const specsDir = path.join(__dirname, 'specs');
const subjects = fs
  .readdirSync(specsDir)
  .filter((f) => f.endsWith('.behaviour.spec.ts'))
  .map((f) => f.replace('.behaviour.spec.ts', ''));

module.exports = {
  rootDir: path.join(__dirname, '..'),
  roots: ['<rootDir>/behaviour', `<rootDir>/${ARM}`],
  testRegex: 'behaviour/specs/.*\\.behaviour\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Transpile only. Three originals do not type-check in isolation; behaviour is
        // what is being compared here, not types.
        diagnostics: false,
        tsconfig: {
          module: 'commonjs',
          target: 'ES2022',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          isolatedModules: true,
          sourceMap: true,
          strict: false,
        },
      },
    ],
  },
  collectCoverageFrom: subjects.map((s) => `${ARM}/${s}.ts`),
  coverageDirectory: `<rootDir>/behaviour/coverage/${ARM}`,
  coverageReporters: ['json-summary', 'text-summary'],
};
