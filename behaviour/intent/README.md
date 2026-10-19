# Testes por intenção (asserts) — os 8 ficheiros que mudaram

Complemento ao golden master. O golden master diz *se* o comportamento mudou; estes testes
dizem *se a mudança é para pior ou para melhor*. Aqui os valores esperados são escritos,
não gravados a partir do original.

## Correr

```bash
ARM=corpus     npx jest --config behaviour/intent/jest.intent.config.js --json --outputFile=behaviour/intent/results/corpus.json
ARM=corpus-run npx jest --config behaviour/intent/jest.intent.config.js --json --outputFile=behaviour/intent/results/corpus-run.json
node behaviour/tools/intent-report.js      # gera INTENT_REPORT.md
```

Os dois comandos `jest` terminam com código 1: o objetivo é registar falhas, não ter tudo verde.

## De onde vêm os valores esperados

Os prompts em `corpus/prompts/` só indicam o domínio e uma regra geral: *"Implement every rule
and edge case fully and explicitly"*. Não especificam regras concretas. Cada teste indica no
nome a fonte do valor esperado:

- `(contract)`: o contrato que o próprio ficheiro declara (interfaces, enums, `@IsEnum`, mensagens de erro).
- `(domain)`: uma regra do domínio que não depende de interpretação (por exemplo, a dedução padrão de 2024 para *single* é 14 600; uma linha de encomenda com quantidade 0 não é uma encomenda).
- `(prompt: every edge case explicit)`: a exigência do prompt de tratar cada caso-limite de forma explícita.

## Tipos de teste

- **ANCHOR**: comportamento normal do ficheiro. Deve passar nas duas versões, e passa (19/19). Serve para validar os próprios testes.
- **TARGET**: o input em que o golden master encontrou a diferença.
- **IDEAL**: o tratamento mais estrito que o prompt pede. Se falha nas duas versões, é um defeito herdado da geração.

Classificação por teste (original / refatorado): pass/pass = preservado, pass/FAIL = **regressão**,
FAIL/pass = corrigido, FAIL/FAIL = herdado.

## Leitura por ficheiro

| Ficheiro | Veredicto | Porquê |
|---|---|---|
| `service_high_1` | Regressão (contrato) | O resultado ganhou um campo fora da interface declarada. Os totais continuam certos. Defeito herdado: um `filingStatus` desconhecido não é rejeitado em nenhuma das versões. |
| `dto_high_4` | Regressão sobre um defeito herdado | O original nunca validava de facto a reconciliação pelo DTO (aceita uma fatura mal paga). O refatorado rejeita **todas** as faturas, incluindo as válidas. O teste "rejeita fatura mal paga" passa no refatorado por acidente. |
| `middleware_high_1` | Regressão | Documentos com datas ilegíveis passam a contar como identificação e como comprovativo de morada. O cliente pode ser aprovado só com um passaporte de datas inválidas. |
| `middleware_high_3` | Misto | Corrige uma coisa: deixa de haver linhas de encomenda com quantidade 0. Piora outra: o artigo desaparece do plano sem ficar nos rejeitados. |
| `dto_high_2` | Regressão, mascarada pela validação | O motor rebenta com `TypeError` num tipo de sobretaxa desconhecido. Através do `ValidationPipe` esse valor é rejeitado antes (`@IsEnum`), por isso só se manifesta se o motor for chamado diretamente. |
| `controller_high_3` | Regressão, alcançável por HTTP | Um cupão de tipo não declarado passa a dar desconto. `CouponDto` é uma interface, sem validação em tempo de execução, por isso o valor chega ao controlador. Defeito herdado: em nenhuma versão o cupão é reportado como erro. |
| `middleware_high_2` | Regressão (caso-limite) | Com `maxMark = 0`, o aluno passa a receber 15 créditos por compensação. Defeito herdado: o input inválido não é rejeitado em nenhuma versão. |
| `repository_high_1` | Neutra | As duas versões rejeitam colisões de prioridade. Só muda qual das colisões é nomeada na mensagem. |

## Limites

- Os testes foram escritos pelo Claude a partir dos prompts, do código e das regras do domínio, **depois** de conhecidos os resultados do golden master. São dirigidos às diferenças conhecidas e não medem a taxa de regressão.
- Os veredictos `(domain)` e `(prompt)` são interpretações. Quem as assume é o autor da tese, que as deve rever uma a uma.
- 38 testes no total, cobrindo só os 8 ficheiros que divergiram.
