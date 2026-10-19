# Verificação de preservação de comportamento (`corpus` vs. `corpus-run`)

Suíte pós-hoc que responde a uma pergunta: **os ficheiros que o guided loop reescreveu
continuam a comportar-se como os originais?** Complementa a verificação de compilabilidade,
que só diz se o código ainda é TypeScript válido.

Resultado da última execução: [`REPORT.md`](REPORT.md). Inspeção manual de cada diferença:
[`DIAGNOSTICO.md`](DIAGNOSTICO.md).

## O que é e o que não é

- **É** um teste diferencial com *golden master*: os mesmos casos correm sobre o original e
  sobre o refatorado, e as saídas têm de coincidir.
- **Não é** prova de equivalência semântica. Um ficheiro "idêntico" é idêntico *nos casos
  executados*; a força dessa evidência é limitada pela cobertura reportada.
- **Não faz parte do loop.** O acceptance guard não foi alterado e o experimento não foi
  repetido. Os testes avaliam as versões já produzidas e versionadas.

## Âmbito

Os 27 ficheiros em que `corpus/` e `corpus-run/` diferem, ou seja, todos os que o loop
tratou. Os outros 33 são byte a byte iguais, logo o comportamento é idêntico por construção.
O braço de controlo (`corpus-baseline/`) não está coberto.

## Como correr

```bash
# 1. Gravar as saídas dos ORIGINAIS (só é permitido com ARM=corpus)
ARM=corpus BEHAVIOUR_MODE=record npx jest --config behaviour/jest.config.js --coverage

# 2. Confirmar que os originais reproduzem o que foi gravado (determinismo)
ARM=corpus npx jest --config behaviour/jest.config.js --coverage

# 3. Congelar a suíte ANTES de olhar para o refatorado, e fazer commit
node behaviour/tools/freeze.js

# 4. Correr os mesmos casos sobre o refatorado
node behaviour/tools/freeze.js --verify
ARM=corpus-run npx jest --config behaviour/jest.config.js --coverage

# 5. Gerar REPORT.md e results/summary.json
node behaviour/tools/report.js
```

A suíte completa demora cerca de 15 segundos por braço. Usa o Jest e o `ts-jest` que o
projeto já tem; não acrescenta dependências e tem configuração própria, separada da do
`package.json`.

Ferramentas auxiliares:

| Ficheiro | Para quê |
|---|---|
| `tools/loadability.behaviour-tool.ts` | Verifica se cada ficheiro importa, antes e depois, e se os exports são os mesmos |
| `tools/freeze.js` | Congela, verifica e regista alterações à maquinaria (`--amend "motivo"`) |
| `tools/make-selfcheck.js` | Gera 8 cópias de originais com uma falha deliberada cada |
| `tools/report.js` | Gera o relatório a partir do que as execuções deixaram em disco |

Para ver em detalhe casos específicos: `BEHAVIOUR_EXPLAIN="rótulo||rótulo" ARM=corpus-run npx jest ...`.

## Estrutura

```
behaviour/
  harness.ts            gravação, comparação, normalização, geradores de entradas
  jest.config.js        configuração própria; ARM escolhe a pasta sob teste
  specs/                um spec por ficheiro do corpus: só define os casos
  golden/               saídas dos originais (hash por caso + 20 amostras legíveis)
  results/<arm>/        resultado por ficheiro; summary.json; loadability.json
  coverage/<arm>/       sumário de cobertura por braço
  selfcheck-arm/        cópias com falhas deliberadas (teste de sanidade da suíte)
  FREEZE.json           hashes da suíte no momento do congelamento
```

## Decisões de protocolo

1. **Só a interface exportada.** Os casos constroem as classes exportadas e chamam os seus
   métodos públicos. Métodos privados nunca são tocados: o Extract Method cria-os e
   renomeia-os livremente, e um teste preso a eles falharia por uma razão que não é
   comportamento. Consequência: ramos inatingíveis pela interface pública não são cobertos
   (ver `middleware_high_4`).
2. **Os valores esperados vêm da execução do original.** Nenhuma asserção foi escrita à mão
   nem por um modelo. O que foi escrito foram *entradas*.
3. **Entradas geradas sistematicamente.** Para cada ficheiro: uma entrada base válida, uma
   lista de valores alternativos por campo retirados das condições do código (limiares,
   valores de enum, valores inválidos), todas as mutações de um campo, e mutações aleatórias
   de vários campos com semente fixa. Componentes com estado usam sequências aleatórias de
   operações, também com semente fixa.
4. **Entradas inválidas fazem parte dos casos.** Incluem valores fora dos tipos declarados
   (enum desconhecido, campo em falta). É uma escolha: o TypeScript não valida em tempo de
   execução, logo esse comportamento é observável. O `DIAGNOSTICO.md` separa as diferenças
   que só aparecem com entradas fora do contrato.
5. **Ambiente fixo para todos os braços.** Relógio congelado em 2026-01-15T12:00Z, `TZ=UTC`,
   `Math.random` com semente reposta em cada caso, `crypto.randomUUID` sequencial.
6. **Semântica JSON na comparação.** Uma propriedade `undefined` equivale a propriedade
   ausente e a ordem das chaves não conta, porque estas saídas atravessam uma fronteira
   HTTP/JSON. Exceções lançadas contam: classe, mensagem, status e corpo da resposta.
7. **Erros do motor de JavaScript comparam-se só pela classe.** A mensagem de um `TypeError`
   cita a expressão que falhou, e muda quando uma variável é renomeada.
8. **Sem tolerância numérica no veredicto.** A comparação é exata. Diferenças que são só
   ruído de vírgula flutuante (relativo < 1e-9) são contadas à parte; nesta execução foram zero.
9. **Congelamento antes de correr o refatorado.** Specs e goldens foram fixados (hashes em
   `FREEZE.json`) antes da primeira execução completa sobre `corpus-run`.

## O que tem de ser declarado

- **Piloto antes do congelamento.** Durante a validação do harness, `middleware_medium_2` e
  `service_high_3` foram corridos sobre `corpus-run` antes de a suíte estar congelada. As
  listas de casos desses dois specs não foram alteradas depois.
- **Uma alteração ao harness depois do congelamento.** Após a primeira execução completa foi
  acrescentada informação de diagnóstico (todos os caminhos que diferem, agrupamento das
  diferenças). Execução, normalização e hashing não mudaram; os goldens continuam a ser
  reproduzidos pelos originais. Registado em `FREEZE.json`, campo `amendments`.
- **`dto_high_3` corre sob um shim.** O ficheiro importa `RegisterDecorator`, que não existe
  no `class-validator`; falha ao importar, no original e no refatorado, com o mesmo erro. O
  spec acrescenta esse alias ao `class-validator`, igual para todos os braços. O resultado
  deste ficheiro deve ser reportado como "executado sob shim".
- **`repository_high_3` tem 46% de cobertura de ramos.** O original chama um método que não
  existe (`checkJobVehicleCompatibility`), o erro de tipos que o impede de compilar. Toda a
  atribuição de rotas lança `TypeError` e o código a jusante é morto. O refatorado preserva
  esse defeito.
- **Quem escreveu os casos.** As entradas e os geradores foram escritos com apoio de um
  assistente de IA (Claude), a partir da leitura de cada original. O risco de viés comum com
  o modelo que refatorou (Gemini) é reduzido por serem modelos diferentes e por os valores
  esperados não dependerem de nenhum modelo.
- **Teste de sanidade, não mutation testing.** Oito falhas deliberadas (limiares e
  constantes) em oito originais foram todas detetadas. Isto mostra que a suíte não é vácua;
  não mede a sua taxa de deteção.

## Limitações

- Cobertura estrutural não é poder de deteção. Uma linha executada pode não ter a sua saída
  suficientemente exercitada.
- Efeitos fora do valor de retorno e das exceções (por exemplo, chamadas de logging) não são
  observados.
- Quando um caso lança exceção, o estado parcial deixado antes do erro só é observado se um
  passo posterior do mesmo cenário o ler.
- Os componentes são testados isoladamente, sem o contentor do NestJS: decoradores de rota,
  pipes e guards não entram na comparação.
