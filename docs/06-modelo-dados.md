# 06 — Modelo de Dados

Dois grupos de tipos: os **contratos do pipeline** (`src/core/types.ts`, trocados entre Evaluator → Feedback → Producer) e os **tipos do relatório** (`src/reporter/reporter.service.ts`, usados na agregação e exportação).

## Diagrama de classes — contratos do pipeline

```mermaid
classDiagram
    class AnalysisReport {
        +string filePath
        +FileMetrics metrics
        +DuplicationIssue[] duplications
        +number duplicationRate
    }
    class FileMetrics {
        +number cyclomaticComplexity
        +number maintainabilityIndex
    }
    class DuplicationIssue {
        +string lines
        +string fragment
    }
    class RefactoringPrompt {
        +string targetFilePath
        +string suggestedPrompt
        +Priority priority
    }
    class Priority {
        <<enumeration>>
        HIGH
        MEDIUM
        LOW
    }
    class OrchestrateDto {
        +string targetDirectory
    }

    AnalysisReport *-- FileMetrics : metrics
    AnalysisReport *-- DuplicationIssue : duplications
    RefactoringPrompt --> Priority
```

## Diagrama de classes — relatório de mitigação

```mermaid
classDiagram
    class MitigationReport {
        +string generatedAt
        +GlobalStats globalStats
        +FileMitigationRecord[] files
    }
    class GlobalStats {
        +number totalFiles
        +number filesConverged
        +number filesNotConverged
        +number filesImproved
        +number avgIterations
        +number avgDeltaCyclomaticComplexity
        +number avgDeltaMaintainabilityIndex
        +number avgDeltaDuplicationRate
    }
    class FileMitigationRecord {
        +string filePath
        +MetricsSnapshot initial
        +MetricsSnapshot final
        +MetricsDelta delta
        +number iterations
        +boolean converged
        +boolean improved
    }
    class MetricsSnapshot {
        +number cyclomaticComplexity
        +number maintainabilityIndex
        +number duplicationRate
    }
    class MetricsDelta {
        +number cyclomaticComplexity
        +number maintainabilityIndex
        +number duplicationRate
    }
    class PartialRecord {
        <<interno>>
        +string filePath
        +MetricsSnapshot initial?
        +MetricsSnapshot final?
        +number iterations?
        +boolean converged?
    }

    MitigationReport *-- GlobalStats
    MitigationReport *-- FileMitigationRecord
    FileMitigationRecord *-- MetricsSnapshot : initial / final
    FileMitigationRecord *-- MetricsDelta : delta
    PartialRecord ..> FileMitigationRecord : materializa em generateReport()
```

## Fluxo dos dados através do pipeline

```mermaid
flowchart LR
    src[/Código fonte .ts/] --> ev[Evaluator]
    ev --> ar[/AnalysisReport/]
    ar --> fb[Feedback]
    fb --> rp[/RefactoringPrompt<br/>ou null/]
    rp --> pr[Producer]
    pr --> gm[/prompt + código → Gemini/]
    gm --> nc[/código refatorado/]
    nc --> src
    ar --> rep[Reporter]
    rep --> ms[/MetricsSnapshot PRÉ e PÓS/]
    ms --> mr[/MitigationReport/]
    mr --> out[/JSON + Markdown +<br/>GET /report/]
    mr --> py[/stats_analysis.py<br/>Wilcoxon + Cliff's δ/]
```

## Semânticas importantes

| Campo | Semântica |
| --- | --- |
| `duplicationRate` | Percentagem 0–100: `(Σ linhas dos fragmentos duplicados ÷ total de linhas) × 100`, com clamp a 100% |
| `delta.*` | Sempre `final − initial`. Melhoria = ΔCC < 0, ΔMI > 0, ΔDUP < 0 |
| `improved` | `true` se **qualquer** delta for na direção de melhoria |
| `converged` | `true` só se o Feedback devolveu `null` dentro do orçamento de 5 iterações |
| `final` quando não converge | Igual a `initial` — o ficheiro original é restaurado, logo o estado real em disco não mudou |
| `generatedAt` / nomes de ficheiro | ISO 8601; no nome do ficheiro `:` e `.` são substituídos por `-` (filesystem-safe) |

## Artefactos persistidos

| Artefacto | Localização | Produtor |
| --- | --- | --- |
| `linterflow-report-{ts}.json` | diretório alvo da orquestração | `ReporterService.exportJson` |
| `linterflow-report-{ts}.md` | diretório alvo da orquestração | `ReporterService.exportMarkdown` |
| `<ficheiro>.ts.bak` | ao lado do ficheiro (temporário, removido no fim) | `ProducerService` |
| `corpus/manifest.json` | plano do experimento + métricas medidas | `scripts/generate-corpus.ts` |
| `corpus/prompts/*.prompt.txt` | 60 prompts Zero-Shot | `scripts/generate-corpus.ts` |
