# LinterFlow

**Static-analysis-guided refactoring of LLM-generated TypeScript code**

Companion artefact of the master's dissertation *Analysis and Automated Structural
Refactoring of LLM-Generated Code in Web Application Development* (Luciano Pena,
ISEP, 2026). It contains the tool, the experimental corpus, the outputs of both
experimental arms and the behavioural test suites used in the dissertation.

## What it does

Code that an LLM writes from a single prompt usually works, but it often carries
structural debt: long functions with deep branching, low maintainability, repeated
blocks. LinterFlow measures that debt with deterministic static analysis and uses
the measurements to steer an LLM through the repair.

For each TypeScript file it:

1. **Measures** cyclomatic complexity per function, the Maintainability Index and
   the duplication rate (Babel AST, `typhonjs-escomplex`, `jscpd`).
2. **Compares** the measurements with fixed thresholds.
3. If a threshold is broken, **builds a targeted instruction** naming the metric,
   the offending functions and their values, and sends it to the LLM
   (`gemini-3.6-flash` by default).
4. **Re-measures** the rewritten file and repeats, up to 5 iterations. An acceptance
   guard keeps a candidate only if it does not make the file worse and keeps the
   original's exported symbols; if the file never converges, the original is restored.
5. **Reports** per-file pre/post metrics and global statistics (JSON and Markdown).

```
Controller → Producer → Evaluator → Feedback → LLM → (loop) → Reporter
```

### Quality thresholds

| Metric | Threshold | Source |
|---|---|---|
| Cyclomatic Complexity, per function | ≤ 10 | McCabe (1976) |
| Maintainability Index | ≥ 65 | Oman & Hagemeister (1992) |
| Duplication rate | ≤ 3% | jscpd |
| Refactoring iterations | ≤ 5 | — |

Defined once in `src/core/types.ts`, shared by the Evaluator and the Feedback module.

## Main results

On a corpus of 60 zero-shot NestJS files (5 component types × 3 complexity tiers ×
4 files), compared with a generic "refactor this" prompt:

- The guided loop removed every function above the complexity threshold, lowered the
  maximum complexity per function by 17.3 points and raised the Maintainability Index
  by 8.1 (Wilcoxon signed-rank, *p* ≤ 0.00001).
- All 60 files meet the quality gates; the 27 that needed treatment converged in a
  mean of 1.41 iterations. The generic prompt fixed 6 of those 27.
- Behaviour was checked after the experiment: 19 of the 27 changed files behave
  identically on the recorded cases and 8 do not; intent-based tests classify six of
  those eight changes as regressions. LinterFlow improves structure; it does not
  guarantee behavioural equivalence.

Full analysis: `docs/10-resultados.md` and the dissertation, Chapter 5.

## Repository layout

```
linterflow-app/
├── src/
│   ├── core/          # Shared types and thresholds
│   ├── evaluator/     # Static analysis (AST, CC, MI, duplication)
│   ├── feedback/      # Turns violations into refactoring instructions
│   ├── producer/      # Self-healing loop, acceptance guard, REST controller
│   ├── reporter/      # Pre/post metrics, JSON and Markdown reports
│   ├── duplication/   # Project-level duplication measurement
│   ├── github/        # Import and analysis of public GitHub repositories
│   ├── auth/ users/ credits/ runs/   # Authentication, accounts, usage, run history
│   └── main.ts
├── public/            # Web UI
├── scripts/           # Experiment scripts (corpus, pipeline, control arm, stats)
├── corpus/            # The 60 original files, prompts and manifest (untouched)
├── corpus-run/        # Arm A: output of the guided loop + reports
├── corpus-baseline/   # Arm B: output of the generic prompt + comparison
├── manual-corpus/     # Second corpus: one app built from a plain-language request
├── manual-corpus-run/ # The same app after LinterFlow
├── behaviour/         # Golden-master suite and intent-based tests (post hoc)
└── docs/              # Design, experiment and results documentation (PT)
```

## Reproducing the experiment

```bash
npm run corpus            # 1a. plan the 60 generation prompts (no API call)
npm run corpus:build      # 1b. generate and measure the corpus (Gemini API)
cp -r corpus/ corpus-run/        # 2. work on a copy: the pipeline overwrites files
npm run pipeline -- corpus-run   #    arm A: guided loop over the copy
npm run baseline          # 3. arm B: generic prompt, one pass, into corpus-baseline/
npx ts-node scripts/compare-arms.ts   # 4. paired comparison of the two arms
npm run stats             # 5. Wilcoxon signed-rank + Cliff's delta
npm run dup               # project-level duplication

# Behavioural checks (no API call; see behaviour/README.md)
node behaviour/tools/freeze.js --verify
ARM=corpus-run npx jest --config behaviour/jest.config.js --coverage
ARM=corpus-run npx jest --config behaviour/intent/jest.intent.config.js
```

LLM outputs are not deterministic, so steps 1b–3 will not reproduce the exact files;
the versioned outputs in `corpus-run/` and `corpus-baseline/` are the ones analysed
in the dissertation. Steps 4–5 and the behavioural checks run on those files and
reproduce the reported numbers.

## Modules

### Core Module (`src/core/types.ts`)
Defines shared interfaces:
- `AnalysisReport` — Results from static analysis
- `FileMetrics` — Cyclomatic Complexity + Maintainability Index per file
- `DuplicationIssue` — Identified code clones with line numbers
- `RefactoringPrompt` — LLM refactoring instruction with priority

### Evaluator Module (`src/evaluator/evaluator.service.ts`)
Performs three-stage analysis:
1. **AST Parsing** — Babel parser with TypeScript, decorators, JSX support
2. **Metrics** — typhonjs-escomplex for CC and MI calculation
3. **Duplication Detection** — jscpd with `minLines: 5`, `minTokens: 50`

### Feedback Module (`src/feedback/feedback.service.ts`)
Evaluates metrics against quality thresholds:
- Suggests design patterns (Strategy, Factory) for high CC
- Recommends simplification for low MI
- Flags code duplication for extraction

Returns `RefactoringPrompt` if issues found, `null` if code is healthy.

### Producer Module (`src/producer/producer.service.ts`)
Self-healing orchestration loop:
1. Scans folder with glob patterns (excludes `node_modules`, `.d.ts`, `.spec.ts`, `.bak`)
2. Creates backup of original file (`.bak`)
3. Loop:
   - Evaluator analyzes code
   - Feedback generates refactoring prompt
   - Gemini API generates refactored code
   - Writes refactored file
4. Converged: Removes backup file
5. Max iterations reached: Restores original file
6. Fatal error: Restores backup

### Reporter Module (`src/reporter/reporter.service.ts`)
Aggregates pre/post metrics and generates reports:
- `reset()` — Clears state before a new run
- `recordInitialMetrics()` — Captures baseline (pre-mitigation) metrics
- `recordFinalMetrics()` — Records final state, iterations, and convergence
- `generateReport()` — Calculates per-file deltas and global statistics
- `exportJson()` / `exportMarkdown()` — Persist the report to disk

### Controller (`src/producer/producer.controller.ts`)
NestJS REST API:

**`POST /api/orchestrator/start`** — starts the pipeline in the background.
```
Content-Type: application/json

{
  "targetDirectory": "./mock-code"
}

Response: 202 Accepted
{
  "status": "PROCESSING",
  "message": "LinterFlow orchestration started successfully in the background.",
  "targetDirectory": "./mock-code",
  "timestamp": "2026-06-21T10:30:00Z"
}
```

**`GET /api/orchestrator/report`** — returns the latest in-memory mitigation report
(per-file pre/post deltas and global statistics from the most recent run).

Interactive **Swagger / OpenAPI** documentation is served at `http://localhost:3000/api`.

## Setup

### Prerequisites
- Node.js 20+ (required by NestJS 11)
- npm
- Google Gemini API key
- Python 3 with `scipy` and `numpy` (only for the statistical analysis script)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Gemini API key:
# GEMINI_MODEL=gemini-3.6-flash
# GEMINI_API_KEY=your_api_key_here
```

### Configuration

**`.env` file:**
```
GEMINI_API_KEY=AIzaSy...        # your Google Gemini API key
GEMINI_MODEL=gemini-3.6-flash   # optional, defaults to gemini-3.6-flash
```

> The server listens on port `3000` (currently hard-coded in `src/main.ts`).

## Usage

### Start the Server

```bash
npm run start
# or, with auto-reload during development:
npm run start:dev
```

- Web UI: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/api`

### Trigger Analysis & Refactoring

Use the Web UI, or call the API directly:

```bash
curl -X POST http://localhost:3000/api/orchestrator/start \
  -H "Content-Type: application/json" \
  -d '{"targetDirectory": "./mock-code"}'
```

Response:
```json
{
  "status": "PROCESSING",
  "message": "LinterFlow orchestration started successfully in the background.",
  "targetDirectory": "./mock-code",
  "timestamp": "2026-06-21T10:30:00Z"
}
```

The orchestration runs asynchronously. When it finishes, a `linterflow-report-*.json`
and `linterflow-report-*.md` are written **into the target directory**. The most recent
report can also be fetched live via `GET /api/orchestrator/report`.

### Experiment

See [Reproducing the experiment](#reproducing-the-experiment) above.

## Running Tests

```bash
# Unit tests
npm run test

# With coverage
npm run test:cov

# Watch mode
npm run test:watch
```

## Exported Reports

Both reports are written into the scanned **target directory**.

### JSON Report
**File:** `linterflow-report-{timestamp}.json`

Contains global statistics plus per-file pre/post metrics and deltas:
```json
{
  "generatedAt": "2026-06-21T10:30:00.000Z",
  "globalStats": {
    "totalFiles": 5,
    "filesConverged": 4,
    "filesNotConverged": 1,
    "filesImproved": 4,
    "avgIterations": 2.5,
    "avgDeltaCyclomaticComplexity": -6.2,
    "avgDeltaMaintainabilityIndex": 15.4,
    "avgDeltaDuplicationRate": -2.1
  },
  "files": [
    {
      "filePath": "/abs/path/service.ts",
      "initial": { "cyclomaticComplexity": 18, "maintainabilityIndex": 52, "duplicationRate": 5.2 },
      "final":   { "cyclomaticComplexity": 8,  "maintainabilityIndex": 72, "duplicationRate": 0 },
      "delta":   { "cyclomaticComplexity": -10, "maintainabilityIndex": 20, "duplicationRate": -5.2 },
      "iterations": 3,
      "converged": true,
      "improved": true
    }
  ]
}
```

### Markdown Report
**File:** `linterflow-report-{timestamp}.md`

Human-readable global summary plus a per-file table (CC / MI / Dup% shown as pre → post / Δ).

## Development

### Adding a New Module

1. Create folder under `src/`
2. Add `.service.ts` and `.module.ts`
3. Register in `AppModule` (`src/app.module.ts`)
4. Write unit tests in `.spec.ts`

### Linting & Formatting

```bash
npm run lint     # ESLint (auto-fixes issues)
npm run format   # Prettier
```

## References

- **Dissertation**: *Analysis and Automated Structural Refactoring of LLM-Generated Code in Web Application Development* — ISEP, 2026
- **McCabe, T.J.** (1976). A Complexity Measure. IEEE Transactions on Software Engineering.
- **Oman, P., & Hagemeister, J.** (1992). Metrics for Measuring the Quality of Modular Design.
- **jscpd**: https://github.com/kucherenko/jscpd (Code clone detection)
- **typhonjs-escomplex**: Code metrics via AST analysis

## License

MIT — see [LICENSE](LICENSE).

## Contact

**Author:** Luciano Pena  
**Email:** 1210648@isep.ipp.pt  
**Institution:** ISEP (Instituto Superior de Engenharia do Porto)
