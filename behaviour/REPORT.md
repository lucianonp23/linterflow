# Behavioural preservation check: corpus vs. corpus-run

Generated 2026-10-07T16:49:08.939Z by `behaviour/tools/report.js`. Suite frozen at 2026-10-07T16:41:51.114Z (1 amendment(s) to the harness, see FREEZE.json).

## Summary

- Files compared: **27** (every file the guided loop changed).
- Cases executed per arm: **192,438**.
- Coverage of the originals: lines **95.7%**, branches **94.7%**, functions **97.6%**.
- Coverage of the refactored files by the same cases: lines **95.7%**, branches **95.0%**.
- Files with identical behaviour on every case: **19/27**.
- Files with at least one differing case: **8/27** (22,007 cases).

## Per file

| File | Cases | Branch cov. (orig.) | Line cov. (orig.) | Differing cases | Verdict |
|---|---:|---:|---:|---:|---|
| `controller_high_1` | 7,077 | 97.24 | 98.75 | 0 | IDENTICAL |
| `controller_high_2` | 3,836 | 100 | 100 | 0 | IDENTICAL |
| `controller_high_3` | 3,400 | 99.51 | 100 | 188 | DIFFERENT |
| `controller_high_4` | 10,263 | 99.56 | 100 | 0 | IDENTICAL |
| `controller_medium_2` | 400 | 100 | 100 | 0 | IDENTICAL |
| `dto_high_1` | 11,191 | 94.17 | 99.52 | 0 | IDENTICAL |
| `dto_high_2` | 9,657 | 98.22 | 99.33 | 1777 | DIFFERENT |
| `dto_high_3` | 7,793 | 97.83 | 100 | 0 | IDENTICAL |
| `dto_high_4` | 7,901 | 100 | 100 | 1471 | DIFFERENT |
| `middleware_high_1` | 6,331 | 98.69 | 100 | 901 | DIFFERENT |
| `middleware_high_2` | 4,006 | 98.36 | 99.54 | 1 | DIFFERENT |
| `middleware_high_3` | 2,213 | 100 | 100 | 149 | DIFFERENT |
| `middleware_high_4` | 9,119 | 71.1 | 83.52 | 0 | IDENTICAL |
| `middleware_medium_1` | 557 | 100 | 100 | 0 | IDENTICAL |
| `middleware_medium_2` | 347 | 100 | 100 | 0 | IDENTICAL |
| `middleware_medium_3` | 744 | 100 | 100 | 0 | IDENTICAL |
| `middleware_medium_4` | 1,025 | 100 | 100 | 0 | IDENTICAL |
| `repository_high_1` | 4,500 | 96.07 | 98.04 | 1 | DIFFERENT |
| `repository_high_2` | 11,767 | 100 | 100 | 0 | IDENTICAL |
| `repository_high_3` | 4,500 | 46 | 44.27 | 0 | IDENTICAL |
| `repository_high_4` | 5,000 | 100 | 100 | 0 | IDENTICAL |
| `repository_medium_3` | 600 | 100 | 100 | 0 | IDENTICAL |
| `repository_medium_4` | 600 | 100 | 100 | 0 | IDENTICAL |
| `service_high_1` | 24,000 | 99.72 | 100 | 17519 | DIFFERENT |
| `service_high_2` | 14,005 | 98.68 | 99.71 | 0 | IDENTICAL |
| `service_high_3` | 1,606 | 99.31 | 99.11 | 0 | IDENTICAL |
| `service_high_4` | 40,000 | 98.89 | 100 | 0 | IDENTICAL |

## Where the differing files differ

### `controller_high_3`: 188 of 3,400 cases

- 166 cases differ in: `$.ok.coupons.ok.discountedSubtotal + $.ok.coupons.ok.totalDiscount` (e.g. case `stateless/20`)
- 6 cases differ in: `$.ok.coupons.ok.discountedSubtotal + $.ok.coupons.ok.totalDiscount + $.ok.validate.ok.pricing.discountTotal + $.ok.validate.ok.pricing.discountedSubtotal + $.ok.validate.ok.pricing.grandTotal + $.ok.validate.ok.pricing.internationalDuties` (e.g. case `stateless/834`)
- 4 cases differ in: `$.ok[].ok.order.pricing.discountTotal + $.ok[].ok.order.pricing.discountedSubtotal + $.ok[].ok.order.pricing.grandTotal` (e.g. case `stateful/25`)

### `dto_high_2`: 1,777 of 9,657 cases

- 1,777 cases differ in: `$.ok + $.threw` (e.g. case `engine/8`)

### `dto_high_4`: 1,471 of 7,901 cases

- 1,465 cases differ in: `$.ok.errors[]` (e.g. case `dto/base`)
- 5 cases differ in: `$.ok + $.threw` (e.g. case `reconciliation/r834:fxRates[8],roundingMode[1],supplierCurrency[0],totalGrossAmount[4],lineItems.0.grossAmount[2],lineItems.0.quantity[2]`)
- 1 cases differ in: `$.ok.valid` (e.g. case `reconciliation/r163:customerCurrency[1],fxRates[5],lineItems[3],totalTaxAmount[2]`)

### `middleware_high_1`: 901 of 6,331 cases

- 441 cases differ in: `$.threw.response.evaluation.reasons[] + $.threw.response.evaluation.riskBreakdown.documentRisk` (e.g. case `applicant-3`)
- 382 cases differ in: `$.ok.req.kycEvaluation.reasons[] + $.ok.req.kycEvaluation.requiredActions[] + $.ok.req.kycEvaluation.riskBreakdown.documentRisk + $.ok.req.kycEvaluation.riskScore` (e.g. case `applicant-26`)
- 65 cases differ in: `$.ok.req.kycEvaluation.reasons[] + $.ok.req.kycEvaluation.requiredActions[] + $.ok.req.kycEvaluation.riskBreakdown.documentRisk + $.ok.req.kycEvaluation.riskScore + $.ok.req.kycEvaluation.status` (e.g. case `applicant-109`)

### `middleware_high_2`: 1 of 4,006 cases

- 1 cases differ in: `$.ok.req.gradingContext.processedModules[].auditLogs[] + $.ok.req.gradingContext.processedModules[].creditsAwarded + $.ok.req.gradingContext.processedModules[].isCompensated + $.ok.req.gradingContext.processedModules[].status + $.ok.req.gradingContext.progression.totalCompensatedCredits + $.ok.req.gradingContext.progression.totalCreditsEarned` (e.g. case `payload-1465`)

### `middleware_high_3`: 149 of 2,213 cases

- 74 cases differ in: `$.ok.req.headers.x-reorder-total-value + $.ok.req.reorderPlanContext.budgetUtilizationPct + $.ok.req.reorderPlanContext.capacityUtilizationPct + $.ok.req.reorderPlanContext.processedItems[] + $.ok.req.reorderPlanContext.rejectedItems[] + $.ok.req.reorderPlanContext.totalOrderValue` (e.g. case `r68:item[0],item.backorders[0]`)
- 22 cases differ in: `$.ok.req.headers.x-reorder-total-value + $.ok.req.reorderPlanContext.budgetUtilizationPct + $.ok.req.reorderPlanContext.capacityUtilizationPct + $.ok.req.reorderPlanContext.processedItems[].finalOrderQuantity + $.ok.req.reorderPlanContext.processedItems[].status + $.ok.req.reorderPlanContext.processedItems[].totalCost` (e.g. case `r72:supplier[0],item.avgDailyDemand[3],item.category[2],params.targetDate[2],supplier.minOrderValue[1],supplier.tier[1]`)
- 18 cases differ in: `$.ok + $.threw` (e.g. case `r52:item[0],item.unitCost[1],params.allowPartialOrders[0],params.emergencyProcurementMode[0],warehouse.zoneCapacities.AMBIENT.maxCBM[0]`)

### `repository_high_1`: 1 of 4,500 cases

- 1 cases differ in: `$.ok[].threw.message + $.ok[].threw.response.message` (e.g. case `scenario-1556`)

### `service_high_1`: 17,519 of 24,000 cases

- 16,437 cases differ in: `$.ok.nonRefundableCredits.aotcRefundable` (e.g. case `return-0`)
- 520 cases differ in: `$.ok.balanceDueOrRefund + $.ok.deductionAmount + $.ok.nonRefundableCredits.aotcRefundable + $.ok.ordinaryIncomeTax + $.ok.ordinaryTaxableIncome + $.ok.taxableIncome` (e.g. case `return-99`)
- 179 cases differ in: `$.ok.alternativeMinimumTax + $.ok.balanceDueOrRefund + $.ok.deductionAmount + $.ok.nonRefundableCredits.aotcRefundable + $.ok.ordinaryIncomeTax + $.ok.ordinaryTaxableIncome` (e.g. case `return-18`)

## Loadability

- `dto_high_3`: original throws TypeError: (0 , class_validator_1.RegisterDecorator) is not a function; refactored throws TypeError: (0 , class_validator_1.RegisterDecorator) is not a function.

See README.md for the protocol and DIAGNOSTICO.md for the manual inspection of each difference.
