# Diagnóstico das diferenças de comportamento

Inspeção manual das 8 diferenças reportadas em [`REPORT.md`](REPORT.md) (execução de
2026-10-07). O relatório é **confirmatório**: casos fixados antes de correr o refatorado. Este
documento é **exploratório**: foi escrito depois de ver os resultados, lendo o código dos
dois lados e correndo sondagens adicionais que não fazem parte da suíte congelada.

## Leitura geral

- **19 de 27** ficheiros produziram saídas idênticas em todos os casos, incluindo os 7 do
  tier `medium` e `controller_high_4`, que deixou de compilar depois do tratamento.
- **8 de 27** ficheiros, todos do tier `high`, têm pelo menos um caso diferente. Nenhuma das
  22 007 diferenças é ruído numérico.
- Em **nenhum** caso o loop removeu ou renomeou um export: é isso que o acceptance guard
  verifica, e verifica bem. As diferenças estão todas abaixo desse nível.

As causas agrupam-se em três padrões.

| Padrão | Ficheiros | O que acontece |
|---|---|---|
| A. `switch` sem `default` substituído por tabela ou ternário | `dto_high_2`, `controller_high_3`, `service_high_1` (parte) | O valor fora do enum deixa de cair no "não faz nada" |
| B. Comparações reescritas que deixam de tratar `NaN` da mesma forma | `dto_high_4`, `middleware_high_2`, `middleware_high_3` (parte) | `if (x > t) return false; if (x < -t) return false` passa a `return Math.abs(x) <= t` |
| C. Reordenação ou extração que muda a lógica | `middleware_high_1`, `middleware_high_3` (parte), `repository_high_1`, `service_high_1` (parte) | Uma condição passa a ser avaliada antes de um `continue`; um campo interno passa a sair no resultado |

## Por ficheiro

A coluna "entradas dentro do contrato" indica se a diferença aparece com entradas que
respeitam os tipos TypeScript declarados no próprio ficheiro.

| Ficheiro | Casos diferentes | Entradas dentro do contrato? | Causa |
|---|---:|---|---|
| `service_high_1` | 17 519 / 24 000 | **Sim** (forma da saída) | O resultado ganhou um campo: `nonRefundableCredits.aotcRefundable` |
| `dto_high_4` | 1 471 / 7 901 | **Sim** | Um pedido válido passa a ser rejeitado pela validação |
| `middleware_high_1` | 901 / 6 331 | **Sim** (caso tratado pelo original) | Documento com datas inválidas passa a contar como identificação |
| `middleware_high_3` | 149 / 2 213 | **Sim**, em parte | Itens com quantidade final 0 deixam de constar do plano |
| `dto_high_2` | 1 777 / 9 657 | Não | `surchargeType` fora do enum: antes valor 0, agora `TypeError` |
| `controller_high_3` | 188 / 3 400 | Não | `discountType` não declarado: antes desconto 0, agora tratado como `fixed` |
| `middleware_high_2` | 1 / 4 006 | Limite (`maxMark = 0`) | Nota `NaN` passa a ser aprovada por compensação |
| `repository_high_1` | 1 / 4 500 | Sim, só a mensagem | Plano com duas colisões de prioridade: a mensagem refere outra colisão |

### `service_high_1`: campo a mais em todas as declarações

O refatorado extraiu o cálculo dos créditos para um método que devolve também
`aotcRefundable`, e o objeto devolvido é colocado tal e qual em `nonRefundableCredits`. O
valor é um dado interno que no original não saía nesse objeto. 16 437 casos diferem só
nisto. Os restantes ~1 080 têm também diferenças numéricas (dedução padrão), e todos usam um
`filingStatus` fora do enum: o original caía num `switch` sem `default` (dedução 0) e o
refatorado usa uma tabela com valor por omissão.

Sondagem adicional: 30 000 declarações só com valores válidos do enum → nenhuma diferença
além do campo a mais.

### `dto_high_4`: pedido válido passa a ser rejeitado

Original:

```ts
if (remainingBalance > tolerance) { return false; }
if (remainingBalance < -tolerance) { return false; }
return true;
```

Refatorado:

```ts
return Math.abs(remainingBalance) <= tolerance;
```

São equivalentes para qualquer número exceto `NaN`: o original devolve `true`, o refatorado
`false`. E `NaN` é o caso normal neste DTO, porque a restrição está aplicada a uma
propriedade booleana (`reconciliationValidationTrigger`) e recebe `true` em vez do pedido.
Resultado: o pedido base, válido, passava a validação no original e falha no refatorado com
`IsInvoiceReconciliationValidConstraint`. O original tem um defeito de desenho (a restrição
é vácua); o refatorado não o corrige, muda-lhe o efeito.

### `middleware_high_1`: documento com datas inválidas conta como identificação

No original, um documento com `issueDate` ou `expiryDate` não interpretável soma risco e é
ignorado (`continue`) antes de se olhar para o tipo. No refatorado, `hasPrimaryId` e
`hasProofOfAddress` são marcados **antes** da verificação das datas:

```ts
for (const doc of payload.documents) {
  if (this.isPrimaryIdType(doc.type)) { hasPrimaryId = true; }
  if (this.isProofOfAddressType(doc.type)) { hasProofOfAddress = true; }
  if (!this.evaluateDocumentDates(doc, now, state)) { continue; }
```

Efeito: desaparecem "No valid primary identity document" e "Proof of address mandatory",
o `documentRisk` desce, e em 65 casos o estado final da avaliação muda. Num controlo de
KYC, é um relaxamento da regra.

Sondagem adicional: 8 000 candidatos só com datas interpretáveis → nenhuma diferença.

### `middleware_high_3`: itens com quantidade 0 e aritmética com `NaN`

Duas causas. (1) O refatorado ganhou uma guarda `if (orderEval.rawQty <= 0)` que descarta
um item cuja quantidade, depois de ajustada à capacidade da zona e ao tamanho da embalagem,
ficou em 0; o original mantinha-o no plano com quantidade 0 e emitia o aviso de valor mínimo
de encomenda. (2) Com payloads incompletos (campos numéricos em falta), o original propagava
`NaN` e o refatorado toma outros ramos.

Sondagem adicional: 12 000 payloads completos → 209 diferentes (1,7%), todos pela causa (1).

### `dto_high_2` e `controller_high_3`: valores fora do enum

`dto_high_2`: `SURCHARGE_STRATEGIES[surcharge.surchargeType]` é `undefined` para um tipo
desconhecido e a chamada seguinte lança `TypeError`; o `switch` original não tinha `default`
e a sobretaxa valia 0. `controller_high_3`: `if (percent) … else if (fixed) …` passou a
`percent ? … : coupon.value`, logo um tipo não declarado é tratado como `fixed`.

Sondagens adicionais: 8 000 pedidos com enums válidos em cada um → nenhuma diferença. Em
produção, o `@IsEnum` do DTO rejeitaria estes valores antes de chegarem ao motor em
`dto_high_2`; em `controller_high_3` o tipo é uma interface, sem validação em runtime.

### `middleware_high_2` e `repository_high_1`: um caso cada

`middleware_high_2`: tentativa com `maxMark = 0` e `rawMark = 0` dá nota `NaN`; o módulo era
`FAILED_NO_RESIT` e passa a `PASSED_BY_COMPENSATION` com 15 créditos. `repository_high_1`:
a deteção de colisões de prioridade passou de dois ciclos encaixados para um `Set`; num
plano com duas colisões, a exceção é a mesma mas a mensagem refere a outra colisão.

## O que isto diz sobre o acceptance guard

O guard garante que o candidato faz parse, mantém os exports e não piora as métricas. As
oito diferenças passam nos três critérios. Três delas resultam diretamente das
transformações que o prompt pede: tabelas de estratégia em vez de `switch` (padrão A) e
extração de métodos (padrão C).

## Por confirmar

- A classificação "dentro/fora do contrato" assenta em sondagens escritas depois de ver os
  resultados. Para ser confirmatória, os casos teriam de ser etiquetados na suíte.
- As causas foram identificadas por leitura dos casos de maior frequência em cada ficheiro;
  os agrupamentos menores de `middleware_high_3` e `service_high_1` não foram todos abertos.
