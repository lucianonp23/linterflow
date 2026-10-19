/**
 * Golden-master / differential harness for the behavioural-preservation check.
 *
 * A spec declares, for one corpus file, a list of cases that drive the file's EXPORTED
 * interface only. Private helpers are never touched: Extract Method creates and renames
 * them freely, and a test bound to them would fail for a non-behavioural reason.
 *
 * In record mode the cases run against the original file and the normalised outputs are
 * hashed into behaviour/golden/<subject>.json. In check mode the same cases run against
 * the selected arm and every hash must match. Expected values are therefore produced by
 * executing the original, never written by hand or by a model.
 */
import * as fs from 'fs';
import * as path from 'path';
// `require`, not `import *`: the interop namespace object is frozen and cannot be spied on.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeCrypto: typeof import('crypto') = require('crypto');

export const ARM = process.env.ARM || 'corpus';
export const MODE = process.env.BEHAVIOUR_MODE || 'check';
export const ORIGINAL_ARM = 'corpus';
const ROOT = path.join(__dirname, '..');
const GOLDEN_DIR = path.join(__dirname, 'golden');
const RESULTS_DIR = path.join(__dirname, 'results', ARM);

/** Every case starts at this instant. Time does not advance unless a case advances it. */
export const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const SAMPLE_OUTPUTS = 20;
const MISMATCH_DETAIL = 25;
const DIFFERENCES_PER_MISMATCH = 12;
/** BEHAVIOUR_EXPLAIN="label||label": always include these cases in the mismatch detail. */
const EXPLAIN = (process.env.BEHAVIOUR_EXPLAIN || '').split('||').filter(Boolean);
const FLOAT_TOLERANCE = 1e-9;

// ---------------------------------------------------------------- determinism

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const realRandom = Math.random;
let uuidCounter = 0;
function fakeUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`;
}

function resetEnvironment(): void {
  jest.setSystemTime(FIXED_NOW);
  Math.random = mulberry32(20260115);
  uuidCounter = 0;
}

function installDeterminism(): void {
  jest.useFakeTimers({
    now: FIXED_NOW,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
      'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
      'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    ],
  });
  jest.spyOn(nodeCrypto, 'randomUUID').mockImplementation(fakeUuid as any);
  const g: any = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    try {
      jest.spyOn(g.crypto, 'randomUUID').mockImplementation(fakeUuid as any);
    } catch {
      /* not spy-able on this runtime; node:crypto is the one the corpus imports */
    }
  }
}

function uninstallDeterminism(): void {
  Math.random = realRandom;
  jest.restoreAllMocks();
  jest.useRealTimers();
}

// -------------------------------------------------------------- normalisation

/**
 * Reduces any value to plain JSON with sorted keys. Outputs of these components cross an
 * HTTP/JSON boundary, so JSON semantics are the observable ones: a property holding
 * `undefined` is equivalent to an absent property, and key order is not behaviour.
 * Thrown errors keep their class, message and HTTP status/response, which ARE behaviour.
 */
export function normalise(value: unknown, seen: unknown[] = []): unknown {
  if (value === undefined) return '__undefined__';
  if (value === null) return null;
  const t = typeof value;
  if (t === 'number') {
    const n = value as number;
    if (Number.isNaN(n)) return '__NaN__';
    if (n === Infinity) return '__Infinity__';
    if (n === -Infinity) return '__-Infinity__';
    return Object.is(n, -0) ? 0 : n;
  }
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'bigint') return `__bigint__${String(value)}`;
  if (t === 'symbol') return `__symbol__${String(value)}`;
  if (t === 'function') return '__function__';
  if (seen.includes(value)) return '__circular__';
  const next = [...seen, value];
  if (value instanceof Date) {
    return { __date__: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString() };
  }
  if (value instanceof RegExp) return { __regexp__: String(value) };
  if (value instanceof Error) return normaliseError(value, next);
  if (value instanceof Map) {
    return { __map__: [...value.entries()].map(([k, v]) => [normalise(k, next), normalise(v, next)]) };
  }
  if (value instanceof Set) return { __set__: [...value.values()].map((v) => normalise(v, next)) };
  if (Array.isArray(value)) return value.map((v) => normalise(v, next));
  if (typeof (value as any).then === 'function') return '__promise__';
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).sort()) {
    const v = (value as any)[key];
    if (v === undefined || typeof v === 'function') continue;
    out[key] = normalise(v, next);
  }
  return out;
}

/**
 * Errors raised by the JavaScript engine itself (a property read on undefined, an invalid
 * array length...). Their message quotes the source expression that failed, so it changes
 * whenever a variable is renamed or an access is moved, with no change in behaviour: in
 * NestJS all of them surface as the same 500. Only their class is compared.
 */
const ENGINE_ERRORS = new Set(['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError']);

function normaliseError(err: any, seen: unknown[]): unknown {
  const name = err?.constructor?.name ?? 'Error';
  if (ENGINE_ERRORS.has(name)) return { __error__: name };
  const out: Record<string, unknown> = {
    __error__: name,
    message: String(err?.message),
  };
  if (typeof err?.getStatus === 'function') out.status = err.getStatus();
  if (typeof err?.getResponse === 'function') out.response = normalise(err.getResponse(), seen);
  return out;
}

/** 80 bits of SHA-256 per case: ample for at most tens of thousands of cases per file. */
function hashOf(value: unknown): string {
  return nodeCrypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
}

function digestOfLabels(labels: string[]): string {
  return nodeCrypto.createHash('sha256').update(labels.join('\n')).digest('hex');
}

// ------------------------------------------------------------- input variants

export const DEL = { __delete__: true } as const;
export class Compute {
  constructor(public readonly fn: (obj: any) => unknown) {}
}
/** A pool value derived from the object being mutated. */
export const compute = (fn: (obj: any) => unknown) => new Compute(fn);

export type Pools = Record<string, unknown[]>;
export interface Variant<T> {
  label: string;
  input: T;
}

function setPath(obj: any, dotted: string, value: unknown): void {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  const resolved = value instanceof Compute ? value.fn(obj) : value;
  if (resolved === DEL) delete cur[last];
  else cur[last] = resolved;
}

/**
 * Systematic input generation from one valid base input and, per field, a pool of
 * alternative values chosen from the branch conditions of the file under test:
 *   1. the base input;
 *   2. every single-field mutation;
 *   3. `random` multi-field mutations (2..maxK fields), from a fixed seed.
 * The same seed gives the same cases on every run and for every arm.
 */
export function variants<T>(
  base: () => T,
  pools: Pools,
  opts: { random?: number; maxK?: number; seed?: number } = {},
): Variant<T>[] {
  const out: Variant<T>[] = [{ label: 'base', input: base() }];
  const paths = Object.keys(pools);
  for (const p of paths) {
    pools[p].forEach((value, idx) => {
      const input = base();
      setPath(input, p, value);
      out.push({ label: `1:${p}[${idx}]`, input });
    });
  }
  const rnd = mulberry32(opts.seed ?? 1);
  const maxK = Math.min(opts.maxK ?? 6, paths.length);
  for (let i = 0; i < (opts.random ?? 0) && paths.length > 1; i++) {
    const k = 2 + Math.floor(rnd() * (maxK - 1));
    const chosen = new Set<string>();
    while (chosen.size < k) chosen.add(paths[Math.floor(rnd() * paths.length)]);
    const input = base();
    const parts: string[] = [];
    // Shorter paths first, so that replacing a whole object happens before its fields.
    for (const p of [...chosen].sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b))) {
      const idx = Math.floor(rnd() * pools[p].length);
      setPath(input, p, pools[p][idx]);
      parts.push(`${p}[${idx}]`);
    }
    out.push({ label: `r${i}:${parts.join(',')}`, input });
  }
  return out;
}

/** Applies 0..maxK random pool picks to a fresh base, using the caller's generator. */
export function mutated<T>(base: () => T, pools: Pools, r: Rng, maxK = 4): T {
  const input = base();
  const paths = Object.keys(pools);
  const chosen = new Set<string>();
  const k = Math.min(r.int(maxK + 1), paths.length);
  while (chosen.size < k) chosen.add(r.pick(paths));
  for (const p of [...chosen].sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b))) {
    setPath(input, p, r.pick(pools[p]));
  }
  return input;
}

/** Full cartesian product over a few fields: for conditions that only fire in combination. */
export function grid<T>(base: () => T, pools: Pools, prefix = 'g'): Variant<T>[] {
  const paths = Object.keys(pools);
  const out: Variant<T>[] = [];
  const walk = (depth: number, picks: number[]) => {
    if (depth === paths.length) {
      const input = base();
      const order = paths.map((p, i) => ({ p, i })).sort((a, b) => a.p.split('.').length - b.p.split('.').length);
      for (const { p, i } of order) setPath(input, p, pools[p][picks[i]]);
      out.push({ label: `${prefix}:${paths.map((p, i) => `${p}[${picks[i]}]`).join(',')}`, input });
      return;
    }
    for (let idx = 0; idx < pools[paths[depth]].length; idx++) walk(depth + 1, [...picks, idx]);
  };
  walk(0, []);
  return out;
}

// ------------------------------------------------------------------ HTTP fakes

export interface HttpInput {
  method?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Minimal Express request/response/next that record everything done to them. */
export function http(input: HttpInput = {}) {
  const calls: unknown[][] = [];
  const nextCalls: unknown[][] = [];
  const headersOut: Record<string, unknown> = {};
  const req: any = {
    method: 'GET',
    headers: {},
    query: {},
    params: {},
    path: '/',
    url: '/',
    originalUrl: '/',
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
    ...input,
  };
  const lookup = (name: string) => {
    const h = req.headers ?? {};
    const key = Object.keys(h).find((k) => k.toLowerCase() === String(name).toLowerCase());
    return key ? h[key] : undefined;
  };
  req.get = lookup;
  req.header = lookup;
  const res: any = { locals: {}, statusCode: 200, headersSent: false };
  for (const m of ['status', 'json', 'send', 'end', 'sendStatus', 'redirect', 'type', 'cookie', 'clearCookie', 'append', 'write']) {
    res[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      if (m === 'status' || m === 'sendStatus') res.statusCode = args[0];
      return res;
    };
  }
  const setHeader = (...args: unknown[]) => {
    calls.push(['setHeader', ...args]);
    if (typeof args[0] === 'string') headersOut[args[0].toLowerCase()] = args[1];
    else if (args[0] && typeof args[0] === 'object') Object.assign(headersOut, args[0]);
    return res;
  };
  res.setHeader = setHeader;
  res.set = setHeader;
  res.header = setHeader;
  res.getHeader = (name: string) => headersOut[String(name).toLowerCase()];
  res.on = () => res;
  res.once = () => res;
  const next = (...args: unknown[]) => {
    nextCalls.push(args);
  };
  const trace = () => ({
    req,
    res: { calls, locals: res.locals, statusCode: res.statusCode, headers: headersOut },
    next: nextCalls,
  });
  return { req, res, next, trace };
}

// ------------------------------------------------------------- DTO validation

function flattenValidationError(e: any): unknown {
  return {
    property: e.property,
    constraints: e.constraints ? normalise(e.constraints) : undefined,
    children: (e.children ?? []).map(flattenValidationError),
  };
}

/**
 * What NestJS's ValidationPipe does with a request body: transform the plain object into
 * the DTO class, then validate it. Returns the transformed instance and the error tree.
 */
export function validateDto(cls: any, plain: unknown, options: Record<string, unknown> = {}): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { plainToInstance } = require('class-transformer');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { validateSync } = require('class-validator');
  const instance = plainToInstance(cls, plain);
  const errors = validateSync(instance as object, options);
  return { instance, errors: errors.map(flattenValidationError) };
}

// ---------------------------------------------------------------- the runner

export interface Case {
  label: string;
  /** Receives the module under test (the selected arm's version of the file). */
  run: (mod: any) => unknown | Promise<unknown>;
}

export interface SubjectOptions {
  /**
   * Re-evaluate the module before every case. Required when the file keeps state at
   * module level (a top-level array or Map acting as a store): without it one case would
   * observe what the previous one wrote.
   */
  freshModule?: boolean;
}

export interface Rng {
  next: () => number;
  int: (n: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (p: number) => boolean;
}

export function rng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  };
}

/** Runs one step of a multi-step scenario and captures its outcome at that moment. */
export function step(fn: () => unknown): unknown {
  try {
    return { ok: normalise(fn()) };
  } catch (err) {
    return { threw: normalise(err) };
  }
}

export async function stepAsync(fn: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    return { ok: normalise(await fn()) };
  } catch (err) {
    return { threw: normalise(err) };
  }
}

export interface Helpers {
  variants: typeof variants;
  grid: typeof grid;
  mutated: typeof mutated;
  http: typeof http;
  validateDto: typeof validateDto;
  DEL: typeof DEL;
  compute: typeof compute;
  NOW: number;
  /** Moves the frozen clock forward inside a multi-step scenario. */
  advance: (ms: number) => void;
  /** Sets the frozen clock to an absolute instant for the current case. */
  setNow: (ms: number) => void;
  rng: typeof rng;
  step: typeof step;
  stepAsync: typeof stepAsync;
}

const helpers: Helpers = {
  variants,
  grid,
  mutated,
  http,
  validateDto,
  DEL,
  compute,
  NOW: FIXED_NOW,
  advance: (ms: number) => jest.setSystemTime(Date.now() + ms),
  setNow: (ms: number) => jest.setSystemTime(ms),
  rng,
  step,
  stepAsync,
};

function load(arm: string, subject: string): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(ROOT, arm, `${subject}.ts`));
}

/**
 * Third-party packages the corpus imports. A fresh module re-evaluates only the file under
 * test; these are loaded once and handed to every fresh copy, which is both faster and
 * closer to a real process, where the framework is a singleton.
 */
const SHARED_PACKAGES = ['@nestjs/common', 'class-validator', 'class-transformer'];
let sharedInstances: Record<string, unknown> | undefined;

function loadFresh(arm: string, subject: string): any {
  if (!sharedInstances) {
    sharedInstances = {};
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    for (const name of SHARED_PACKAGES) sharedInstances[name] = require(name);
  }
  const shared = sharedInstances;
  let mod: any;
  jest.isolateModules(() => {
    for (const name of SHARED_PACKAGES) jest.doMock(name, () => shared[name]);
    mod = load(arm, subject);
  });
  return mod;
}

async function execute(c: Case, getModule: () => any): Promise<unknown> {
  resetEnvironment();
  try {
    return { ok: normalise(await c.run(getModule())) };
  } catch (err) {
    return { threw: normalise(err instanceof Error ? err : new Error(`non-error thrown: ${String(err)}`)) };
  }
}

function firstDifference(a: any, b: any, at = '$'): { path: string; expected: unknown; actual: unknown } | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return { path: at, expected: a, actual: b };
  }
  if (Array.isArray(a) !== Array.isArray(b)) return { path: at, expected: a, actual: b };
  if (Array.isArray(a) && a.length !== b.length) {
    return { path: `${at}.length`, expected: a.length, actual: b.length };
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (!(k in a) || !(k in b)) return { path: `${at}.${k}`, expected: a[k], actual: b[k] };
    const d = firstDifference(a[k], b[k], `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

/** Every differing path between two normalised outputs, up to a limit. Diagnosis only. */
function allDifferences(a: any, b: any, limit: number, at = '$', acc: { path: string; expected: unknown; actual: unknown }[] = []): typeof acc {
  if (acc.length >= limit || a === b) return acc;
  const leaf = typeof a !== typeof b || a === null || b === null || typeof a !== 'object' || Array.isArray(a) !== Array.isArray(b);
  if (leaf) {
    acc.push({ path: at, expected: clip(a), actual: clip(b) });
    return acc;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (acc.length >= limit) break;
    if (!(k in a) || !(k in b)) acc.push({ path: `${at}.${k}`, expected: clip(a[k]), actual: clip(b[k]) });
    else allDifferences(a[k], b[k], limit, `${at}.${k}`, acc);
  }
  return acc;
}

/** True when two outputs differ only by floating-point noise below the tolerance. */
function equalWithinTolerance(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= FLOAT_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && equalWithinTolerance(a[k], b[k]));
}

function clip(value: unknown): unknown {
  const s = JSON.stringify(value);
  return s !== undefined && s.length > 400 ? `${s.slice(0, 400)}…` : value;
}

export function defineSubject(subject: string, build: (h: Helpers) => Case[], options: SubjectOptions = {}): void {
  const moduleGetter = (arm: string): (() => any) => {
    if (options.freshModule) return () => loadFresh(arm, subject);
    const shared = load(arm, subject);
    return () => shared;
  };

  describe(`${subject} [${ARM}]`, () => {
    beforeAll(installDeterminism);
    afterAll(uninstallDeterminism);

    it('produces the outputs recorded from the original file', async () => {
      const goldenPath = path.join(GOLDEN_DIR, `${subject}.json`);
      const getModule = moduleGetter(ARM);
      const cases = build(helpers);
      const labels = cases.map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);

      const outputs: unknown[] = [];
      for (const c of cases) outputs.push(await execute(c, getModule));
      const hashes = outputs.map(hashOf);

      if (MODE === 'record') {
        if (ARM !== ORIGINAL_ARM) throw new Error('Golden outputs may only be recorded from the original corpus.');
        fs.writeFileSync(
          goldenPath,
          `${JSON.stringify(
            {
              subject,
              recordedFrom: ORIGINAL_ARM,
              cases: cases.length,
              threw: outputs.filter((o: any) => 'threw' in o).length,
              // The case list is defined by the spec; this digest proves it has not changed.
              labelsDigest: digestOfLabels(labels),
              samples: outputs.slice(0, SAMPLE_OUTPUTS).map((output, i) => ({ label: labels[i], output })),
              hashes,
            },
          )}\n`,
        );
        return;
      }

      if (!fs.existsSync(goldenPath)) throw new Error(`No golden file for ${subject}; record it first.`);
      const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
      expect(labels.length).toBe(golden.hashes.length);
      expect(digestOfLabels(labels)).toBe(golden.labelsDigest);

      const failing = hashes.map((h, i) => (h === golden.hashes[i] ? -1 : i)).filter((i) => i >= 0);

      // Diagnosis only: re-run the failing cases on the original to show WHAT differs.
      const mismatches: unknown[] = [];
      // How the failing cases differ, grouped: "which output fields changed" -> number of cases.
      const signatures = new Map<string, { cases: number; example: string }>();
      let floatNoiseOnly = 0;
      if (failing.length > 0) {
        const getOriginal = moduleGetter(ORIGINAL_ARM);
        for (const i of failing) {
          const expected = await execute(cases[i], getOriginal);
          const noise = equalWithinTolerance(expected, outputs[i]);
          if (noise) floatNoiseOnly += 1;
          const signature = [...new Set(allDifferences(expected, outputs[i], 40).map((d) => d.path.replace(/\.\d+(?=\.|$)/g, '[]')))].sort().slice(0, 6).join(' + ');
          const entry = signatures.get(signature) ?? { cases: 0, example: labels[i] };
          entry.cases += 1;
          signatures.set(signature, entry);
          if (mismatches.length < MISMATCH_DETAIL || EXPLAIN.includes(labels[i])) {
            const diff = firstDifference(expected, outputs[i]);
            mismatches.push({
              label: labels[i],
              floatNoiseOnly: noise,
              firstDifferenceAt: diff?.path,
              expected: clip(diff?.expected),
              actual: clip(diff?.actual),
              differences: allDifferences(expected, outputs[i], DIFFERENCES_PER_MISMATCH),
            });
          }
        }
      }

      fs.mkdirSync(RESULTS_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${subject}.json`),
        `${JSON.stringify(
          {
            subject,
            arm: ARM,
            cases: cases.length,
            identical: cases.length - failing.length,
            different: failing.length,
            differentByFloatNoiseOnly: floatNoiseOnly,
            differenceSignatures: [...signatures.entries()]
              .map(([fields, v]) => ({ fields, ...v }))
              .sort((a, b) => b.cases - a.cases)
              .slice(0, 40),
            mismatches,
          },
          null,
          1,
        )}\n`,
      );

      if (failing.length > 0) {
        throw new Error(
          `${failing.length}/${cases.length} cases differ from the original ` +
            `(${floatNoiseOnly} by floating-point noise only). First: ${JSON.stringify(mismatches[0])}`,
        );
      }
    }, 300000);
  });
}
