#!/usr/bin/env node
/**
 * Freezes the behavioural suite BEFORE it is run against any refactored arm.
 *
 * Writes behaviour/FREEZE.json with a SHA-256 of the harness, the Jest config, every spec
 * and every golden file, plus the SHA-256 of each original and each refactored corpus file
 * the suite covers. Run it once the specs pass on the originals; commit the result; only
 * then run `ARM=corpus-run`. `node behaviour/tools/freeze.js --verify` re-computes the
 * hashes and fails if anything changed since the freeze.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..', '..');
const behaviour = path.join(root, 'behaviour');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const list = (dir, suffix) => fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).sort();

const subjects = list(path.join(behaviour, 'specs'), '.behaviour.spec.ts').map((f) => f.replace('.behaviour.spec.ts', ''));
const snapshot = {
  suite: {
    'harness.ts': sha(path.join(behaviour, 'harness.ts')),
    'jest.config.js': sha(path.join(behaviour, 'jest.config.js')),
  },
  specs: Object.fromEntries(subjects.map((s) => [s, sha(path.join(behaviour, 'specs', `${s}.behaviour.spec.ts`))])),
  golden: Object.fromEntries(subjects.map((s) => [s, sha(path.join(behaviour, 'golden', `${s}.json`))])),
  originals: Object.fromEntries(subjects.map((s) => [s, sha(path.join(root, 'corpus', `${s}.ts`))])),
  treated: Object.fromEntries(subjects.map((s) => [s, sha(path.join(root, 'corpus-run', `${s}.ts`))])),
};
const freezePath = path.join(behaviour, 'FREEZE.json');

const amendAt = process.argv.indexOf('--amend');
if (amendAt >= 0) {
  // The suite's machinery changed after the freeze (e.g. richer diagnostic output). Allowed
  // only while every spec, golden file and corpus file is byte-identical to the freeze.
  const reason = process.argv[amendAt + 1];
  if (!reason) throw new Error('--amend needs a reason');
  const frozen = JSON.parse(fs.readFileSync(freezePath, 'utf8'));
  for (const group of ['specs', 'golden', 'originals', 'treated']) {
    for (const [name, hash] of Object.entries(snapshot[group])) {
      if (frozen[group][name] !== hash) throw new Error(`Cannot amend: ${group}/${name} changed since the freeze.`);
    }
  }
  const changes = Object.entries(snapshot.suite).filter(([name, hash]) => frozen.suite[name] !== hash).map(([name, hash]) => ({ file: name, from: frozen.suite[name], to: hash }));
  if (changes.length === 0) {
    console.log('Nothing to amend.');
  } else {
    frozen.amendments = [...(frozen.amendments || []), { at: new Date().toISOString(), reason, changes }];
    frozen.suite = snapshot.suite;
    fs.writeFileSync(freezePath, `${JSON.stringify(frozen, null, 1)}\n`);
    console.log(`Amended ${changes.map((c) => c.file).join(', ')}: ${reason}`);
  }
} else if (process.argv.includes('--verify')) {
  const frozen = JSON.parse(fs.readFileSync(freezePath, 'utf8'));
  const changed = [];
  for (const group of Object.keys(snapshot)) {
    for (const [name, hash] of Object.entries(snapshot[group])) {
      if (frozen[group]?.[name] !== hash) changed.push(`${group}/${name}`);
    }
  }
  if (changed.length) {
    console.error(`Changed since freeze (${frozen.frozenAt}):\n  ${changed.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Unchanged since freeze (${frozen.frozenAt}): ${subjects.length} subjects.`);
} else {
  const cases = subjects.reduce((n, s) => n + JSON.parse(fs.readFileSync(path.join(behaviour, 'golden', `${s}.json`), 'utf8')).cases, 0);
  fs.writeFileSync(freezePath, `${JSON.stringify({ frozenAt: new Date().toISOString(), subjects: subjects.length, cases, ...snapshot }, null, 1)}\n`);
  console.log(`Frozen ${subjects.length} subjects, ${cases} cases -> behaviour/FREEZE.json`);
}
