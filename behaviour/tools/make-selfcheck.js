#!/usr/bin/env node
/**
 * Seeded-fault sanity check for the behavioural suite.
 *
 * Copies a few ORIGINAL corpus files into behaviour/selfcheck-arm/ with exactly one small,
 * deliberate fault each (a boundary, a constant). Running the frozen suite against that
 * folder must report every one of them as different:
 *
 *   node behaviour/tools/make-selfcheck.js
 *   ARM=behaviour/selfcheck-arm npx jest --config behaviour/jest.config.js \
 *       "(middleware_medium_2|service_high_3|controller_high_4|repository_medium_4|controller_high_2|middleware_high_2|repository_high_4|service_high_4)"
 *
 * This is NOT mutation testing: eight hand-picked faults show the suite is not vacuous,
 * they do not measure its detection rate.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'behaviour', 'selfcheck-arm');
const faults = [
  ['middleware_medium_2', 'body.quantity > 10000', 'body.quantity >= 10000'],
  ['service_high_3', 'finalScore >= 65', 'finalScore > 65'],
  ['controller_high_4', 'calculatedOTHours * baseHourlyRate * 1.5', 'calculatedOTHours * baseHourlyRate * 1.25'],
  ['repository_medium_4', 'if (points < 100)', 'if (points <= 100)'],
  ['controller_high_2', 'effectiveCreditScore >= 740', 'effectiveCreditScore > 740'],
  ['middleware_high_2', 'lateDays * 5', 'lateDays * 4'],
  ['repository_high_4', 'priceAfter = currentPrice * 1.3;', 'priceAfter = currentPrice * 1.25;'],
  ['service_high_4', 'vitals.glasgowComaScale <= 8', 'vitals.glasgowComaScale < 8'],
];

fs.mkdirSync(out, { recursive: true });
const manifest = [];
for (const [subject, from, to] of faults) {
  const source = fs.readFileSync(path.join(root, 'corpus', `${subject}.ts`), 'utf8');
  const occurrences = source.split(from).length - 1;
  if (occurrences !== 1) throw new Error(`${subject}: expected exactly one occurrence of "${from}", found ${occurrences}`);
  fs.writeFileSync(path.join(out, `${subject}.ts`), source.replace(from, to));
  manifest.push({ subject, from, to });
}
fs.writeFileSync(path.join(out, 'FAULTS.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`Wrote ${faults.length} seeded-fault copies to behaviour/selfcheck-arm/`);
