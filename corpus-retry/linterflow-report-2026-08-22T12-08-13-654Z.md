# LinterFlow Mitigation Report

_Generated at: 2026-08-22T12:08:13.653Z_

## Global Summary

| Metric | Value |
| --- | --- |
| Total files | 5 |
| Converged | 5 |
| Not converged | 0 |
| Improved | 5 |
| Avg. iterations | 1.40 |
| Avg. Δ Max CC (gate) | -46.20 |
| Avg. Δ CC violations | -3.20 |
| Avg. Δ Total CC | +9.80 |
| Avg. Δ Maintainability Index | +20.40 |
| Avg. Δ Duplication Rate (%) | 0.00 |
| Complexity redistributed, not removed | 4 |

> **Max CC** is the gate (no function may exceed the threshold). **Violations** counts the functions over it. **Total CC** sums every function: a falling max with a flat or rising total means the branching was relocated by Extract Method, not eliminated.

## Per-File Results

| File | Max CC (pre→post / Δ) | Viol. (pre→post) | Total CC (pre→post / Δ) | Fns (pre→post) | MI (pre→post / Δ) | Dup% (pre→post / Δ) | Iter | Converged |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dto_high_2.ts | 46 → 7 / -39.00 | 3 → 0 | 104 → 119 / +15.00 | 25 → 56 | 84.8 → 96.7 / +11.93 | 0.0 → 0.0 / 0.00 | 1 | ✅ |
| dto_high_1.ts | 21 → 7 / -14.00 | 6 → 0 | 151 → 173 / +22.00 | 43 → 101 | 88.8 → 105.3 / +16.50 | 0.0 → 0.0 / 0.00 | 1 | ✅ |
| controller_high_4.ts | 101 → 10 / -91.00 | 1 → 0 | 123 → 121 / -2.00 | 6 → 25 | 52.5 → 77.2 / +24.73 | 0.0 → 0.0 / 0.00 | 2 | ✅ |
| controller_high_3.ts | 31 → 9 / -22.00 | 5 → 0 | 129 → 140 / +11.00 | 14 → 50 | 71.0 → 94.0 / +23.03 | 0.0 → 0.0 / 0.00 | 2 | ✅ |
| controller_high_2.ts | 75 → 10 / -65.00 | 1 → 0 | 111 → 114 / +3.00 | 5 → 23 | 61.4 → 87.2 / +25.80 | 0.0 → 0.0 / 0.00 | 1 | ✅ |
