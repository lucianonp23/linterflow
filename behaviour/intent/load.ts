import * as path from 'path';

export const ARM = process.env.ARM || 'corpus';
export const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const ROOT = path.join(__dirname, '..', '..');

/** Loads one corpus file from the selected arm (corpus = original, corpus-run = refactored). */
export function load(subject: string): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(ROOT, ARM, `${subject}.ts`));
}

/** Freezes the clock at the same instant as the golden-master suite. */
export function freezeClock(): void {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
  });
}

/** Runs fn and returns the thrown error, or undefined if it did not throw. */
export function thrown(fn: () => unknown): any {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}
