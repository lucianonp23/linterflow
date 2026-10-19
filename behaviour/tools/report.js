#!/usr/bin/env node
/**
 * Builds behaviour/REPORT.md and behaviour/results/summary.json from what the runs left on
 * disk: golden files, coverage summaries of each arm, per-subject results and loadability.
 * Reads only; re-run it after any run of the suite.
 */
const fs = require('fs');
const path = require('path');

const behaviour = path.join(__dirname, '..');
const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : undefined);
const subjects = fs.readdirSync(path.join(behaviour, 'specs')).filter((f) => f.endsWith('.behaviour.spec.ts')).map((f) => f.replace('.behaviour.spec.ts', '')).sort();
const coverageOf = (arm) => {
  const summary = read(path.join(behaviour, 'coverage', arm, 'coverage-summary.json')) || {};
  const byName = {};
  for (const [file, v] of Object.entries(summary)) byName[path.basename(file, '.ts')] = v;
  return { byName, total: summary.total };
};
const original = coverageOf('corpus');
const treated = coverageOf('corpus-run');
const loadability = read(path.join(behaviour, 'results', 'loadability.json')) || [];
const freeze = read(path.join(behaviour, 'FREEZE.json'));
const pct = (v) => (v ? `${v.pct.toFixed(1)}` : 'n/a');

const rows = subjects.map((subject) => {
  const golden = read(path.join(behaviour, 'golden', `${subject}.json`));
  const self = read(path.join(behaviour, 'results', 'corpus', `${subject}.json`));
  const run = read(path.join(behaviour, 'results', 'corpus-run', `${subject}.json`));
  const load = loadability.find((l) => l.subject === subject) || {};
  const [component, tier] = subject.split('_');
  return {
    subject,
    component,
    tier,
    cases: golden.cases,
    casesThrowingInOriginal: golden.threw,
    originalLoads: load.corpus,
    treatedLoads: load['corpus-run'],
    sameExports: load.sameExports,
    originalLineCoverage: original.byName[subject]?.lines.pct,
    originalBranchCoverage: original.byName[subject]?.branches.pct,
    treatedLineCoverage: treated.byName[subject]?.lines.pct,
    treatedBranchCoverage: treated.byName[subject]?.branches.pct,
    originalReproducesGolden: self ? self.different === 0 : undefined,
    treatedIdentical: run ? run.identical : undefined,
    treatedDifferent: run ? run.different : undefined,
    treatedDifferentFloatNoiseOnly: run ? run.differentByFloatNoiseOnly : undefined,
    verdict: !run ? 'NOT RUN' : run.different === 0 ? 'IDENTICAL' : 'DIFFERENT',
    topDifferences: run ? (run.differenceSignatures || []).slice(0, 3) : [],
  };
});

const totals = {
  subjects: rows.length,
  cases: rows.reduce((n, r) => n + r.cases, 0),
  identicalSubjects: rows.filter((r) => r.verdict === 'IDENTICAL').length,
  differentSubjects: rows.filter((r) => r.verdict === 'DIFFERENT').length,
  differentCases: rows.reduce((n, r) => n + (r.treatedDifferent || 0), 0),
  originalCoverage: original.total,
  treatedCoverage: treated.total,
};
fs.writeFileSync(path.join(behaviour, 'results', 'summary.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), frozenAt: freeze?.frozenAt, totals, rows }, null, 1)}\n`);

const lines = [];
lines.push('# Behavioural preservation check: corpus vs. corpus-run', '');
lines.push(`Generated ${new Date().toISOString()} by \`behaviour/tools/report.js\`. Suite frozen at ${freeze?.frozenAt ?? 'NOT FROZEN'}${freeze?.amendments?.length ? ` (${freeze.amendments.length} amendment(s) to the harness, see FREEZE.json)` : ''}.`, '');
lines.push('## Summary', '');
lines.push(`- Files compared: **${totals.subjects}** (every file the guided loop changed).`);
lines.push(`- Cases executed per arm: **${totals.cases.toLocaleString('en-US')}**.`);
lines.push(`- Coverage of the originals: lines **${pct(original.total?.lines)}%**, branches **${pct(original.total?.branches)}%**, functions **${pct(original.total?.functions)}%**.`);
lines.push(`- Coverage of the refactored files by the same cases: lines **${pct(treated.total?.lines)}%**, branches **${pct(treated.total?.branches)}%**.`);
lines.push(`- Files with identical behaviour on every case: **${totals.identicalSubjects}/${totals.subjects}**.`);
lines.push(`- Files with at least one differing case: **${totals.differentSubjects}/${totals.subjects}** (${totals.differentCases.toLocaleString('en-US')} cases).`, '');
lines.push('## Per file', '');
lines.push('| File | Cases | Branch cov. (orig.) | Line cov. (orig.) | Differing cases | Verdict |');
lines.push('|---|---:|---:|---:|---:|---|');
for (const r of rows) {
  lines.push(`| \`${r.subject}\` | ${r.cases.toLocaleString('en-US')} | ${r.originalBranchCoverage ?? 'n/a'} | ${r.originalLineCoverage ?? 'n/a'} | ${r.treatedDifferent ?? 'n/a'} | ${r.verdict} |`);
}
lines.push('', '## Where the differing files differ', '');
for (const r of rows.filter((x) => x.verdict === 'DIFFERENT')) {
  lines.push(`### \`${r.subject}\`: ${r.treatedDifferent.toLocaleString('en-US')} of ${r.cases.toLocaleString('en-US')} cases`, '');
  for (const d of r.topDifferences) lines.push(`- ${d.cases.toLocaleString('en-US')} cases differ in: \`${d.fields}\` (e.g. case \`${d.example}\`)`);
  lines.push('');
}
lines.push('## Loadability', '');
for (const l of loadability.filter((x) => x.corpus !== 'loads' || x['corpus-run'] !== 'loads')) {
  lines.push(`- \`${l.subject}\`: original ${l.corpus}; refactored ${l['corpus-run']}.`);
}
lines.push('', 'See README.md for the protocol and DIAGNOSTICO.md for the manual inspection of each difference.', '');
fs.writeFileSync(path.join(behaviour, 'REPORT.md'), lines.join('\n'));
console.log(`REPORT.md: ${totals.identicalSubjects}/${totals.subjects} identical, ${totals.differentSubjects} different, ${totals.cases} cases.`);
