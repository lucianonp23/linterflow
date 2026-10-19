# 08 — Decisões de Arquitetura (ADRs)

Registo das decisões estruturantes, no formato contexto → decisão → consequências.

---

## ADR-001 — NestJS como framework base

**Contexto.** O sistema precisa de API REST, injeção de dependências para isolar módulos testáveis, e configuração por ambiente. O próprio objeto de estudo da dissertação é código NestJS gerado por LLM.

**Decisão.** NestJS 11 sobre Express, com um módulo por responsabilidade (Producer, Evaluator, Feedback, Reporter) e `ConfigModule` global.

**Consequências.** DI torna cada serviço mockável isoladamente nos specs; o corpus experimental e o próprio sistema partilham o mesmo ecossistema, o que valida o Evaluator sobre código idiomático NestJS (decorators, etc. — daí o plugin `decorators-legacy` no Babel).

---

## ADR-002 — Separação Producer / Evaluator / Feedback / Reporter

**Contexto.** Self-healing loops misturam medição, decisão e ação; se estas responsabilidades se entrelaçam, os limiares espalham-se pelo código e o sistema torna-se intestável.

**Decisão.** Quatro serviços com papéis exclusivos: Evaluator só mede, Feedback só decide (limiares vivem apenas aqui), Producer é o único com efeitos secundários (fs + rede), Reporter só acumula e exporta.

**Consequências.** Alterar um limiar é uma mudança de uma linha num único ficheiro; o Evaluator pode ser reutilizado standalone (ex.: medir o corpus); os testes do Producer mockam os restantes três serviços.

---

## ADR-003 — Limiares: CC ≤ 10, MI ≥ 65, DUP ≤ 3%, 5 iterações

**Contexto.** Os limiares têm de ser defensáveis perante um júri académico, não arbitrários.

**Decisão.** CC ≤ 10 (McCabe, 1976), MI ≥ 65 (Oman, 1992), duplicação ≤ 3% (default de gates de qualidade como o SonarQube), máximo 5 iterações de refactoring.

**Consequências.** A taxa de duplicação exigiu o campo `duplicationRate` no `AnalysisReport` — um limiar de "qualquer clone = falha" (versão inicial) era demasiado agressivo e desalinhado da literatura. O orçamento de 5 iterações limita o custo por ficheiro a 5 chamadas de API.

---

## ADR-004 — API assíncrona com `202 Accepted`

**Contexto.** Uma orquestração pode demorar minutos (N ficheiros × até 5 chamadas LLM). Um handler síncrono causaria timeout HTTP.

**Decisão.** `POST /start` dispara `orchestrateFolder()` **sem `await`** (fire-and-forget com `.catch()` para logging) e responde `202` de imediato. O progresso consulta-se via `GET /report` ou pelos ficheiros exportados.

**Consequências.** Cliente nunca bloqueia; em contrapartida não há push de progresso (polling apenas) e um erro de background só aparece nos logs. Alternativas descartadas por complexidade desnecessária para um protótipo de investigação: fila de jobs (Bull), WebSockets/SSE.

---

## ADR-005 — Backup `.bak` + restauro como rede de segurança

**Contexto.** O LLM pode devolver código inválido ou pior; o pipeline reescreve ficheiros reais no disco.

**Decisão.** Antes do loop, o original é copiado para `<ficheiro>.bak`. Convergiu → apaga-se o `.bak`. Não convergiu ou erro fatal → restaura-se o original. O glob ignora `**/*.bak` para o backup nunca entrar na análise.

**Consequências.** O pior caso é neutro (ficheiro intacto), o que também protege a validade do experimento: não-convergência resulta em delta = 0, nunca numa regressão gravada. O `generateAST()` no início de cada iteração garante que código não-parseável do Gemini cai no ramo de erro e aciona o restauro.

---

## ADR-006 — jscpd por ficheiro, não por pasta

**Contexto.** A versão inicial corria `detectDuplications(rootDir)` para cada ficheiro: cada análise via os clones da pasta inteira, inflacionando a métrica de todos os ficheiros e tornando-a não-atribuível.

**Decisão.** O jscpd corre sobre o **ficheiro em análise** (`detectDuplications(filePath)`); a taxa é calculada contra as linhas desse ficheiro.

**Consequências.** A métrica torna-se intra-ficheiro e atribuível — coerente com o desenho experimental (unidade de análise = ficheiro). Clones entre ficheiros deixam de ser detetados (limitação conhecida e assumida; o jscpd precisa de ≥ 2 ficheiros para clones cross-file).

---

## ADR-007 — `typhonjs-escomplex` e `jscpd` via `require`

**Contexto.** Ambos os pacotes têm exports incompatíveis com named imports ESM/TypeScript (`escomplex.analyzeModule` não é exportado de forma tipada).

**Decisão.** Carregar via `require` com fallback `module.default || module`. Intencional — não "corrigir" para import.

**Consequências.** Perde-se tipagem estática nesses dois pontos (uso de `any` localizado no Evaluator); em troca, evita-se transpilação frágil. Documentado no código para não ser revertido por engano.

---

## ADR-008 — Extração de código da resposta do LLM com regex + fallback

**Contexto.** Apesar da instrução "return ONLY raw code", os LLMs frequentemente embrulham a resposta em fences Markdown.

**Decisão.** Regex `` ```(?:typescript|ts|javascript|js)?\n([\s\S]*?)``` `` captura o primeiro bloco; sem match, removem-se todos os fences e faz-se `trim()`.

**Consequências.** Robusto aos formatos comuns de resposta. Se restar prosa fora dos fences, o código resultante não parseia — e o `generateAST()` da iteração seguinte apanha o problema (defesa em profundidade com o ADR-005).

---

## ADR-009 — Reporter em memória com export para disco

**Contexto.** O experimento precisa de deltas pré/pós por ficheiro; a API precisa de expor o último relatório; o script Python precisa de um artefacto estável.

**Decisão.** Estado em `Map<filePath, PartialRecord>` (com `reset()` por execução), materializado em `MitigationReport` e exportado para JSON (input do `stats_analysis.py`) e Markdown (leitura humana) no diretório alvo.

**Consequências.** Zero dependências de base de dados; o relatório em memória perde-se num restart, mas os ficheiros exportados são a fonte de verdade do experimento. Quando um ficheiro não converge, o snapshot final registado = inicial (reflete o restauro do original).

---

## ADR-010 — Geração do corpus manual e sem API

**Contexto.** O corpus Zero-Shot tem de ser reprodutível e não pode ser contaminado por instruções de qualidade. Gerar automaticamente via API acoplaria o experimento a um único modelo e dificultaria a verificação de banda de CC.

**Decisão.** `generate-corpus.ts` produz apenas **prompts** (60 ficheiros `.prompt.txt` + `PROMPTS.md` + `manifest.json` com slots de medição). A geração do código é manual: o investigador cola cada prompt num agente AI, mede o output, e regenera se o CC sair da banda do tier.

**Consequências.** Reprodutibilidade total (prompts versionados), flexibilidade de modelo gerador (registado em `generatedWith`), e verificação de tier como passo explícito do protocolo. Custo: trabalho manual de 60+ gerações.

---

## Trade-offs em aberto (TODOs conhecidos)

| Item | Estado |
| --- | --- |
| Prompts incrementais (um problema por prompt, em vez de todos juntos) | TODO no `FeedbackService` |
| Prompts adaptativos com base no histórico de iterações | TODO no `FeedbackService` |
| Deteção de clones cross-file | Fora de âmbito (ver ADR-006) |
| Push de progresso (SSE/WebSocket) | Fora de âmbito (ver ADR-004) |
