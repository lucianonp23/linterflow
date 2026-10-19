# Desvios entre o corpus desenhado e o corpus materializado

> Registo das diferenças entre o desenho experimental (fase 1a, `npm run corpus`) e o
> corpus efectivamente produzido (fase 1b, `npm run corpus:build`).
>
> Serve de fonte para a secção de **ameaças à validade** da dissertação. Ao contrário do
> `manifest.json`, este ficheiro **não é regenerado por nenhum script** — é o registo
> autoritativo. Relacionado: `FLUXO-GERACAO.md` ·
> `../docs/07-experimento.md`
>
> Estado final: **55/60 em banda**, média de 1,58 tentativas. Materializado entre
> 2026-08-14 e 2026-08-15 com `gemini-3.6-flash`, temperatura 0,9.

---

## Resultado por célula

Ficheiros dentro da banda de complexidade pretendida, em 4 por célula:

| | low | medium | high | total |
|---|---|---|---|---|
| **controller** | 4/4 | 4/4 | 4/4 | 12/12 |
| **service** | 4/4 | 4/4 | 4/4 | 12/12 |
| **repository** | 4/4 | 3/4 | 4/4 | 11/12 |
| **middleware** | 4/4 | **0/4** | 4/4 | 8/12 |
| **dto** | 4/4 | 4/4 | 4/4 | 12/12 |
| | **20/20** | **15/20** | **20/20** | **55/60** |

Amplitude do máximo de CC por função, nos ficheiros em banda: `low` 1–5 · `medium` 8–10 ·
`high` 18–150. **Os tiers não se sobrepõem**, que é a condição de que o desenho depende.

Os 60 ficheiros existem em disco e entram todos no experimento. "Fora de banda" significa
que o CC medido não caiu no intervalo pretendido para o tier — não que o ficheiro tenha
sido descartado.

---

## 1. Recalibração da diretiva do tier `medium` — 2026-08-15

**O que mudou.** A `TIER_SPEC.medium` em `scripts/generate-corpus.ts` foi reescrita a meio
da materialização, e os 20 prompts do tier `medium` foram regerados.

Antes:

> Scope: a domain with a moderate set of business rules. **Implement every rule fully,
> including the conditional branching and loops they require.**

Depois:

> Scope: a domain with a moderate set of business rules — **four to seven independent
> validity or state checks in its busiest operation**, and fewer in the others. Implement
> each check as a direct conditional; **the checks stand alone rather than combining into
> nested special cases.**

**Porquê.** A formulação original era, na prática, a diretiva do `high` com um domínio mais
pequeno: o "implement every rule fully" empurrava o modelo a concentrar toda a lógica num
único handler. Medições contra a banda pretendida (máx. CC por função entre 6 e 10):

| Ficheiro | Tentativas (máx. CC) | Resultado |
|---|---|---|
| `controller_medium_1` | 17, 15, 15, 11, 14 | fora de banda |
| `controller_medium_2` | 24, 27, 13, 12, 24 | fora de banda |
| `controller_medium_3` | 26, 17, 36 | fora de banda |

Zero em banda em treze gerações; a distribuição centrava-se nos 15–25. Como **o prompt
nunca é editado entre tentativas** — condição Zero-Shot —, cada tentativa é apenas outra
amostra da mesma distribuição enviesada, e mais repetições nunca resolveriam o problema.
A correcção tinha de ser na fase 1a.

**Resultado.** O tier `medium` passou de 0/20 para **15/20**, com os ficheiros a aterrarem
entre 8 e 10 — distribuídos pela banda, não colados a um extremo.

**Ressalva metodológica.** O comentário de desenho original afirma que a banda é *"induced
through the domain, not requested as a number"*. Quantificar "four to seven checks"
aproxima-se de prescrever um valor. A condição Zero-Shot mantém-se intacta — o prompt
continua sem mencionar complexidade, qualidade, métricas ou padrões de desenho —, mas o
tier `medium` passa a ser quantitativamente mais dirigido do que o `low` e o `high`, que
permanecem puramente qualitativos. **Esta assimetria deve ser declarada na metodologia.**

**Impacto na comparabilidade.** Os ficheiros `low` e `high` foram gerados a partir de
prompts nunca alterados. Apenas o tier `medium` usa prompts da segunda versão. As medições
`low` existentes foram preservadas na regeneração do manifest; as medições `medium`
obsoletas foram invalidadas, por descreverem um prompt que já não existe.

---

## 2. `middleware × medium` — 0/4, por razão estrutural

| Ficheiro | Domínio | Máx. CC final | Funções |
|---|---|---|---|
| `middleware_medium_1` | ride fare estimation with surge time windows | 20 | 1 |
| `middleware_medium_2` | inventory restock with reorder thresholds | 19 | 1 |
| `middleware_medium_3` | appointment scheduler with working-hour constraints | 20 | 1 |
| `middleware_medium_4` | currency exchange with tiered spreads | 20 | 1 |

Os quatro esgotaram as 5 tentativas. Repare-se na coluna das funções: **`fns=1` em todos**.

**Motivo: a forma do componente impõe um piso de complexidade.** Um middleware NestJS é,
por definição, um único método `use()`. Não há vários handlers por onde a lógica se
distribua — todas as regras do domínio caem obrigatoriamente na mesma função. Nos outros
quatro tipos de componente, quatro a sete verificações repartem-se por vários métodos, e o
máximo por função fica na banda; num middleware somam-se todas no mesmo sítio.

**Não é uma falha do tipo de componente.** `middleware × low` fez 4/4 e `middleware × high`
fez 4/4. O que não existe é a janela **intermédia**: com poucas regras o middleware fica
trivial (CC ≤ 5), e a partir de meia dúzia salta directamente para os 19–20. Para esta
forma de componente, a banda 6–10 é quase vazia.

**Porque é um achado e não um defeito.** O corpus assenta no pressuposto de que a
complexidade é induzida **através do domínio e da forma do componente**, e não pedida como
número. Estes quatro casos são evidência directa: quando a estrutura do componente e a
diretiva do prompt pedem coisas incompatíveis, a estrutura ganha. Sustenta o pressuposto de
desenho em vez de o contrariar.

**Consequência para a análise.** A célula fica com n=0 em banda. Os quatro ficheiros
**entram na mesma no experimento**, com CC inicial de 19–20 em vez dos 6–10 pretendidos.
Para análises por tier devem ser tratados como `medium` (é o seu tier de desenho),
assinalando o CC real. Análises que cruzem tipo de componente com tier não podem afirmar
nada sobre `middleware × medium`.

---

## 3. `repository_medium_3` — fora de banda, caso isolado

| Campo | Valor |
|---|---|
| Tier / banda pretendida | `medium` · 5 < máx. CC ≤ 10 |
| Domínio | *a support ticket queue with priority routing* |
| Máx. CC final | 21 (13 funções) |
| Tentativas | 5 |

Ao contrário da célula do middleware, este não tem explicação estrutural: as 13 funções dão
espaço de sobra para a lógica se distribuir. É o domínio que resiste — encaminhamento por
prioridade é uma cascata de decisões que se combinam, e a diretiva pede verificações
independentes que não se combinem. Quando o domínio e a diretiva pedem coisas opostas, o
domínio ganha.

É a única das cinco falhas que poderia plausivelmente ser recuperada com mais tentativas ou
com a troca do domínio. **Decisão: manter como está**, para não introduzir na célula um
enviesamento a favor dos domínios que cooperam com a diretiva. A célula `repository × medium`
fica com n=3.

---

## 4. Fase 2 — cinco ficheiros re-executados após falhas de rede

Na primeira passagem da mitigação, cinco ficheiros do tier `high` — `dto_high_1`,
`dto_high_2`, `controller_high_2`, `controller_high_3` e `controller_high_4` — ficaram
registados como **não-convergidos**. A assinatura era inconsistente com esgotamento do
orçamento: pararam à 1.ª ou 2.ª iteração, e não à 5.ª, com as métricas finais iguais às
iniciais. Isso corresponde ao ramo de erro fatal do `ProducerService`, não ao fim das
tentativas.

**Causa.** A política de retry (`src/core/retry.ts`) não classificava `fetch failed` como
transitório. O `undici` do Node colapsa qualquer falha ao nível da ligação — DNS, TLS,
socket caído — nessa mensagem única, e guarda a causa real em `error.cause`, que o
classificador não lia. O erro escapava ao ciclo, o ficheiro era revertido e o Reporter
registava uma não-convergência que nunca aconteceu. Dois outros ficheiros
(`middleware_high_2`, `middleware_high_3`) perderam-se da mesma forma e foram detectados
durante a run; ambos convergiram depois da correcção.

**Recuperação.** Corrigido o classificador, os cinco ficheiros foram copiados de `corpus/`
para um directório isolado e reprocessados. Os cinco convergiram, sem uma única falha nem
retry. Os registos foram fundidos no relatório principal, com **verificação programática de
que o snapshot "pré" era idêntico** ao da primeira passagem — condição sem a qual a fusão
seria inválida. Os `globalStats` foram recalculados a partir de `files[]`, e o campo
`provenance` do relatório documenta a operação.

**Porque não é selecção de resultados.** Os cinco tinham estado final igual ao inicial: o
pipeline não produziu resultado nenhum para eles, nem bom nem mau. Não se repetiu uma
execução por não se gostar do resultado; completou-se uma execução que errou por causa de
infraestrutura. O critério de re-execução foi definido antes de se conhecer o desfecho —
falha fatal com métricas inalteradas — e aplicado a todos os casos que o cumpriam.

> Ainda assim, isto deve constar da dissertação. Um leitor tem direito a saber que 5 dos 60
> resultados vêm de uma segunda execução, e que a taxa de convergência de 60/60 depende
> dessa recuperação. Sem ela seria 55/60.

---

## 5. Notas de execução que afectam a reprodutibilidade

**Duas chaves de API, dois dias.** A materialização decorreu em 2026-08-14 e 2026-08-15, com
duas chaves diferentes, devido a limites de quota do tier gratuito. A chave é apenas
autenticação e não influencia a geração, mas o `manifest.json` regista somente
`generatedWith: "gemini-3.6-flash"` — não a data nem a credencial. Quem reproduzir o
trabalho não consegue, a partir do artefacto, saber que ficheiro veio de que sessão.

**`gemini-3.6-flash` é um alias.** Se a Google actualizar o modelo por trás dele, ficheiros
gerados em datas diferentes podem vir de versões diferentes sem que nada o assinale. É o
maior risco de reprodutibilidade deste corpus, e não é mitigável a posteriori.

**A temperatura de 0,9 não teve efeito nenhum.** O `build-corpus.ts` envia
`temperature: 0.9` e o manifest regista-a, mas a partir do Gemini 3.6 Flash a Google
**deprecou** `temperature`, `top_p` e `top_k`: são aceites e descartados em silêncio, sem
erro nem aviso, e modelos futuros devolverão HTTP 400. Verificado empiricamente a
2026-08-16 — o mesmo prompt enviado duas vezes a `temperature: 0` devolveu respostas
diferentes, e as temperaturas 0 e 2 produziram o mesmo par de saídas.

Consequências para a redacção da metodologia:

- **Não declarar 0,9 como parâmetro do estudo.** Seria descrever como controlada uma
  variável que o modelo ignorou. O correcto é dizer que a amostragem ficou nos valores
  internos da Google, não configuráveis.
- **A regeneração fora de banda funcionou por outra razão** que não a documentada. O
  comentário original do script afirmava que a temperatura tinha de ser > 0 senão a
  regeneração devolveria o ficheiro idêntico. É falso para este modelo: a dispersão
  observada (um ficheiro mediu 17, 15, 15, 11, 14 em cinco tentativas do mesmo prompt) vem
  da não-determinação inerente do modelo.
- **Não há como fixar a amostragem** para tornar a geração reprodutível. Repetir a fase 1b
  com os mesmos prompts produzirá outro corpus. Esta é uma limitação do modelo, não do
  desenho, mas tem de ser declarada.

Pela mesma razão, o pipeline de mitigação **não envia parâmetros de amostragem**. A
variação entre iterações vem do modelo; o que distingue uma repetição é o prompt, que
passa a incluir o motivo pelo qual o candidato anterior foi rejeitado.

**Contagem de tentativas.** O campo `attempts` do manifest regista as tentativas da **última
corrida** de cada ficheiro, não o total acumulado. Ficheiros retomados em corridas
sucessivas — o script volta a tentar tudo o que tenha `inBand: false` — mostram um valor
inferior ao esforço real. Exemplo: `controller_medium_2` regista `attempts: 1` mas consumiu
quatro rondas de cinco tentativas antes de entrar em banda com CC=9.

**Duplicação residual.** Apenas 6 dos 55 ficheiros em banda têm taxa de duplicação não nula
(máx. 7,26%). Como antecipado no desenho, a `duplicationRate` não
tem variação suficiente para sustentar um teste de Wilcoxon com significado.
