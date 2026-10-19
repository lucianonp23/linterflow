# 03 — Fluxo do Pipeline (Self-Healing Loop)

## Fluxograma completo — orquestração de uma pasta

`ProducerService.orchestrateFolder(targetDirectory)`:

```mermaid
flowchart TD
    start([POST /api/orchestrator/start]) --> scan["glob '**/*.ts'<br/>ignora: node_modules, .d.ts, .spec.ts, .bak"]
    scan --> reset["reporter.reset()"]
    reset --> next{Há ficheiros<br/>por processar?}
    next -- sim --> file[processSingleFile]
    file --> next
    next -- não --> gen["reporter.generateReport()"]
    gen --> json[exportJson<br/>linterflow-report-ts.json]
    gen --> md[exportMarkdown<br/>linterflow-report-ts.md]
    json --> done([Orquestração completa])
    md --> done
```

## Fluxograma detalhado — self-healing loop por ficheiro

`ProducerService.processSingleFile(filePath, rootDir)`:

```mermaid
flowchart TD
    A([Início: ficheiro .ts]) --> B["Ler conteúdo original<br/>criar backup .bak"]
    B --> C["Análise PRÉ-mitigação<br/>analyzeFile: CC + MI + DUP + taxa"]
    C --> D["reporter.recordInitialMetrics()"]
    D --> E{"iteração < 5<br/>e não passou?"}

    E -- sim --> F[iteração++]
    F --> G[Ler ficheiro do disco]
    G --> H["evaluator.generateAST()<br/>valida que ainda parseia"]
    H --> I["analyzeFile()<br/>CC, MI, duplicações, taxa"]
    I --> J["feedback.generateRefactoringPrompt(report)"]
    J --> K{Prompt gerado?}

    K -- "null (código saudável)" --> L[passou = true]
    L --> M["✨ Convergiu:<br/>recordFinalMetrics(converged=true)<br/>apagar .bak"]

    K -- "RefactoringPrompt" --> N["executeGeminiRefactor()<br/>prompt + código original"]
    N --> O["Extrair código da resposta<br/>regex de code-block com fallback"]
    O --> P["fs.writeFileSync<br/>aplicar código refatorado"]
    P --> E

    E -- "não (5 iterações esgotadas)" --> Q["❌ Não convergiu:<br/>recordFinalMetrics(converged=false)<br/>restaurar original, apagar .bak"]

    H -. "erro de parse /<br/>erro Gemini / erro IO" .-> R["Erro fatal:<br/>recordFinalMetrics(converged=false)<br/>restaurar original, apagar .bak"]
    N -. erro .-> R

    M --> Z([Fim do ficheiro])
    Q --> Z
    R --> Z
```

## Diagrama de sequência — uma iteração com refactoring

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente HTTP
    participant PC as ProducerController
    participant PS as ProducerService
    participant EV as EvaluatorService
    participant FB as FeedbackService
    participant GM as Gemini API
    participant RP as ReporterService
    participant FS as Filesystem

    C->>PC: POST /api/orchestrator/start {targetDirectory}
    PC->>PS: orchestrateFolder(dir) — sem await
    PC-->>C: 202 Accepted {status: PROCESSING}

    PS->>FS: glob **/*.ts
    PS->>RP: reset()

    loop para cada ficheiro
        PS->>FS: ler original + escrever .bak
        PS->>EV: analyzeMetrics + detectDuplications + calculateDuplicationRate
        EV-->>PS: AnalysisReport (estado inicial)
        PS->>RP: recordInitialMetrics(path, metrics, dupRate)

        loop até 5 iterações ou convergência
            PS->>EV: generateAST(código) — validação
            PS->>EV: analyzeFile(código)
            EV-->>PS: AnalysisReport
            PS->>FB: generateRefactoringPrompt(report)
            alt código saudável
                FB-->>PS: null
                PS->>RP: recordFinalMetrics(converged=true)
                PS->>FS: apagar .bak
            else limiares violados
                FB-->>PS: RefactoringPrompt {prompt, priority}
                PS->>GM: generateContent(prompt + código)
                GM-->>PS: código refatorado
                PS->>FS: writeFileSync(código novo)
            end
        end

        opt máx. iterações atingido
            PS->>RP: recordFinalMetrics(converged=false)
            PS->>FS: restaurar original + apagar .bak
        end
    end

    PS->>RP: generateReport()
    RP-->>PS: MitigationReport
    PS->>FS: exportJson + exportMarkdown

    C->>PC: GET /api/orchestrator/report
    PC->>RP: generateReport()
    RP-->>C: 200 OK — MitigationReport
```

## Máquina de estados — ciclo de vida de um ficheiro

```mermaid
stateDiagram-v2
    [*] --> Descoberto : encontrado pelo glob
    Descoberto --> ComBackup : original copiado para .bak
    ComBackup --> EmAnalise : métricas iniciais registadas

    EmAnalise --> Saudavel : Feedback devolve null
    EmAnalise --> EmRefactoring : prompt gerado (iter < 5)

    EmRefactoring --> EmAnalise : Gemini devolve código,<br/>ficheiro reescrito
    EmRefactoring --> Falhado : erro fatal<br/>(parse / API / IO)

    EmAnalise --> Esgotado : 5 iterações sem convergir

    Saudavel --> Convergido : .bak removido,<br/>converged = true
    Esgotado --> Restaurado : original restaurado,<br/>converged = false
    Falhado --> Restaurado : original restaurado,<br/>converged = false

    Convergido --> [*]
    Restaurado --> [*]
```

## Decisão do Feedback (Reflector)

Lógica de `FeedbackService.generateRefactoringPrompt`:

```mermaid
flowchart TD
    in[AnalysisReport] --> cc{CC > 10?}
    cc -- sim --> icc["issue: reduzir condicionais aninhadas<br/>sugerir Strategy Pattern / extrair helpers<br/>prioridade = HIGH"]
    cc -- não --> mi
    icc --> mi{MI < 65?}
    mi -- sim --> imi["issue: simplificar lógica,<br/>nomes descritivos<br/>prioridade ≥ MEDIUM"]
    mi -- não --> dup
    imi --> dup{taxa duplicação > 3%?}
    dup -- sim --> idup["issue: extrair lógica duplicada<br/>para utilitário partilhado - DRY<br/>prioridade = HIGH"]
    dup -- não --> any
    idup --> any{Alguma issue?}
    any -- não --> null[/return null — código saudável/]
    any -- sim --> prompt["Montar system prompt:<br/>persona Software Architect +<br/>lista de issues + constraints<br/>(manter lógica, devolver só código)"]
    prompt --> out[/RefactoringPrompt<br/>targetFilePath + suggestedPrompt + priority/]
```

## Extração do código da resposta do Gemini

A resposta do LLM pode vir com ou sem fences de Markdown. A extração é feita em duas fases:

1. Regex `` /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/ `` — captura o primeiro code-block e usa o seu conteúdo.
2. Fallback — se não houver code-block, remove todas as ocorrências de `` ```typescript `` e `` ``` `` e faz `trim()`.

O resultado é escrito diretamente no ficheiro; a validação acontece na iteração seguinte via `generateAST()` — se o Gemini devolver código que não parseia, o erro é apanhado e o original restaurado.
