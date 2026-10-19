import { defineSubject } from '../harness';

defineSubject('dto_high_4', (h) => {
  const tax = (o: Record<string, unknown> = {}) => ({ taxType: 'VAT', ratePercent: 20, taxableAmount: 100, taxAmount: 20, taxJurisdiction: 'PT', isExempt: false, ...o });
  const line = (o: Record<string, unknown> = {}) => ({
    lineId: 'L1', description: 'Consulting', quantity: 2, unitPrice: 50, discountAmount: 0, taxDetails: [tax()], netAmount: 100, grossAmount: 120, ...o,
  });
  const pay = (o: Record<string, unknown> = {}) => ({
    paymentId: 'P1', paymentCurrency: 'USD', allocatedAmount: 120, fxRateUsed: 1, allocatedAmountInInvoiceCurrency: 120, bankFeeAmount: 0,
    bankFeeAbsorbedBySupplier: false, paymentDate: '2026-01-10T00:00:00.000Z', paymentMethod: 'WIRE', transactionReference: 'TX-1', ...o,
  });
  const dispute = (o: Record<string, unknown> = {}) => ({
    disputeId: 'D1', reason: 'PRICE_MISMATCH', status: 'OPEN', disputedAmount: 20, description: 'Price differs from PO', raisedAt: '2026-01-05T00:00:00.000Z', resolutionAmount: 0, ...o,
  });
  const fx = (from: string, to: string, rate: number, o: Record<string, unknown> = {}) => ({ fromCurrency: from, toCurrency: to, rate, effectiveDate: '2026-01-01', provider: 'ECB', ...o });

  const base = () => ({
    invoiceId: 'INV-1',
    invoiceNumber: '2026/0001',
    issueDate: '2026-01-01',
    dueDate: '2026-01-31',
    supplierCurrency: 'USD',
    customerCurrency: 'EUR',
    reconciliationCurrency: 'USD',
    roundingMode: 'HALF_UP',
    toleranceThreshold: 0.05,
    fxRates: [fx('EUR', 'USD', 1.1, { invertedRate: 0.909 })] as any,
    lineItems: [line()] as any,
    payments: [pay()] as any,
    disputes: [] as any,
    totalNetAmount: 100,
    totalTaxAmount: 20,
    totalGrossAmount: 120,
    reconciliationValidationTrigger: true as any,
  });

  const fxSets = [
    [],
    [fx('USD', 'USD', 1)],
    [fx('USD', 'USD', 1.5)],
    [fx('EUR', 'USD', 1.1, { invertedRate: 0.5 })],
    [fx('EUR', 'USD', 1.1), fx('USD', 'EUR', 0.91)],
    [fx('EUR', 'USD', 1.1), fx('USD', 'EUR', 0.7)],
    [fx('GBP', 'USD', 1.25), fx('EUR', 'USD', 1.3), fx('JPY', 'USD', 0.0067)],
    [fx('EUR', 'USD', 0), fx('XXX', 'USD', -1, { provider: '', effectiveDate: 'nope' })],
    'not-an-array',
    null,
  ];
  const taxSets = [
    [],
    [tax({ isExempt: true, taxAmount: 0, exemptionReason: 'Export' })],
    [tax({ isExempt: true, taxAmount: 0 })],
    [tax({ isExempt: true, taxAmount: 5, exemptionReason: 'Export' })],
    [tax({ taxType: 'ZERO_RATED', taxAmount: 0 })],
    [tax({ taxType: 'EXEMPT', taxAmount: 3 })],
    [tax(), tax({ taxType: 'WITHHOLDING', ratePercent: 10, taxAmount: 10 })],
    [tax({ taxAmount: 20.02 })],
    [tax({ taxAmount: 20.03 })],
    [tax({ ratePercent: 101, taxableAmount: -1, taxJurisdiction: '', isExempt: 'no', taxType: 'LUXURY' })],
    'not-an-array',
  ];
  const paymentSets = [
    [],
    [pay({ allocatedAmount: 100, allocatedAmountInInvoiceCurrency: 100 })],
    [pay({ allocatedAmount: 60, allocatedAmountInInvoiceCurrency: 60 }), pay({ paymentId: 'P2', allocatedAmount: 60, allocatedAmountInInvoiceCurrency: 60 })],
    [pay({ fxRateUsed: 1.01 })],
    [pay({ allocatedAmountInInvoiceCurrency: 119.5 })],
    [pay({ paymentCurrency: 'EUR', allocatedAmount: 109.09, fxRateUsed: 1.1, allocatedAmountInInvoiceCurrency: 120 })],
    [pay({ paymentCurrency: 'EUR', allocatedAmount: 109.09, fxRateUsed: 1.3, allocatedAmountInInvoiceCurrency: 141.82 })],
    [pay({ paymentCurrency: 'EUR', allocatedAmount: 109.09, fxRateUsed: 1.1, allocatedAmountInInvoiceCurrency: 125 })],
    [pay({ paymentCurrency: 'GBP', allocatedAmount: 96, fxRateUsed: 1.25, allocatedAmountInInvoiceCurrency: 120 })],
    [pay({ bankFeeAmount: 15, bankFeeAbsorbedBySupplier: true })],
    [pay({ bankFeeAmount: 15, bankFeeAbsorbedBySupplier: false })],
    [pay({ allocatedAmount: 135, allocatedAmountInInvoiceCurrency: 135, bankFeeAmount: 15, bankFeeAbsorbedBySupplier: true })],
    [pay({ allocatedAmount: 500, allocatedAmountInInvoiceCurrency: 500 })],
    [pay({ allocatedAmount: 120.04, allocatedAmountInInvoiceCurrency: 120.04 })],
    [pay({ paymentId: '', paymentCurrency: 'XXX', allocatedAmount: 0, paymentDate: 'x', paymentMethod: 'CASH', transactionReference: '' })],
    null,
  ];
  const disputeSets = [
    [dispute()],
    [dispute({ lineItemId: 'L1' })],
    [dispute({ lineItemId: 'L9' })],
    [dispute({ lineItemId: 'L1', disputedAmount: 120.02 })],
    [dispute({ disputedAmount: 121 })],
    [dispute({ status: 'RESOLVED_CREDIT_MEMO', resolutionAmount: 20, resolvedAt: '2026-01-08T00:00:00.000Z' })],
    [dispute({ status: 'RESOLVED_WAIVED', resolutionAmount: 20 })],
    [dispute({ status: 'RESOLVED_WAIVED', resolutionAmount: 0, resolvedAt: '2026-01-08T00:00:00.000Z' })],
    [dispute({ status: 'RESOLVED_CREDIT_MEMO', resolutionAmount: 25, resolvedAt: '2026-01-08T00:00:00.000Z' })],
    [dispute({ status: 'REJECTED' })],
    [dispute({ status: 'REJECTED', resolutionAmount: 5 })],
    [dispute({ status: 'UNDER_INVESTIGATION' })],
    [dispute({ status: 'OPEN', resolutionAmount: 1 })],
    [dispute({ status: 'ESCALATED' })],
    [dispute({ disputeId: '', reason: 'OTHER', disputedAmount: 0, description: '', raisedAt: 'x', resolvedAt: 'y', resolutionAmount: -1 })],
    null,
  ];
  const pools = {
    invoiceId: ['', 5],
    issueDate: ['not-a-date', h.DEL],
    supplierCurrency: ['EUR', 'JPY', 'XXX', h.DEL],
    customerCurrency: ['USD', 'ZZZ'],
    reconciliationCurrency: ['JPY', 'EUR', h.DEL],
    roundingMode: ['HALF_EVEN', 'FLOOR', 'CEIL', 'BANKERS', h.DEL],
    toleranceThreshold: [0, 1, 20, 101, -1, h.DEL, null],
    fxRates: fxSets,
    lineItems: [[], null, [line(), line({ lineId: 'L2', quantity: 1, unitPrice: 30, taxDetails: [], netAmount: 30, grossAmount: 30 })], 'x'],
    'lineItems.0.quantity': [3, 0, 1.005, '2'],
    'lineItems.0.unitPrice': [0.125, 33.335, 49.999, -1],
    'lineItems.0.discountAmount': [10, 500, 0.005],
    'lineItems.0.netAmount': [100.01, 100.02, 90, 0.12, 0.13, 33.34, 33.33],
    'lineItems.0.grossAmount': [120.02, 120.03, 100, 110, 20.12],
    'lineItems.0.taxDetails': taxSets,
    'lineItems.0.lineId': ['', 'L1x'],
    payments: paymentSets,
    disputes: disputeSets,
    totalNetAmount: [100.05, 100.06, 99, 130, -1],
    totalTaxAmount: [20.05, 20.06, 0, 30],
    totalGrossAmount: [120.05, 120.06, 119, 150, 100, 0],
    reconciliationValidationTrigger: [false, h.DEL, 'yes'],
  };

  const cases: { label: string; run: (mod: any) => unknown }[] = [];
  const args = (object: unknown) => ({ object, value: undefined, constraints: [], targetName: 'InvoiceReconciliationRequestDto', property: 'x' });

  for (const { label, input } of h.variants(base, pools, { random: 1500, maxK: 6, seed: 71 })) {
    cases.push({ label: `dto/${label}`, run: (mod) => h.validateDto(mod.InvoiceReconciliationRequestDto, input) });
  }
  for (const { label, input } of h.variants(base, pools, { random: 3000, maxK: 7, seed: 72 })) {
    cases.push({
      label: `reconciliation/${label}`,
      run: (mod) => {
        const c = new mod.IsInvoiceReconciliationValidConstraint();
        return { valid: c.validate(input, args(input)), message: c.defaultMessage(args(input)) };
      },
    });
    cases.push({
      label: `line-math/${label}`,
      run: (mod) => {
        const c = new mod.IsLineItemMathValidConstraint();
        return { valid: c.validate((input as any).lineItems, args(input)), message: c.defaultMessage(args(input)) };
      },
    });
  }
  fxSets.forEach((rates, i) => {
    cases.push({
      label: `fx/${i}`,
      run: (mod) => {
        const c = new mod.IsFXRateMapValidConstraint();
        return { valid: c.validate(rates, args({})), message: c.defaultMessage(args({})) };
      },
    });
  });
  for (const [i, v] of [null, undefined, false].entries()) {
    cases.push({ label: `reconciliation/empty-${i}`, run: (mod) => new mod.IsInvoiceReconciliationValidConstraint().validate(v, args({})) });
  }
  // Nested DTO classes, validated on their own.
  const nested: [string, () => unknown][] = [['FXRateDto', () => fx('EUR', 'USD', 1.1)], ['TaxDetailDto', () => tax()], ['InvoiceLineItemDto', () => line()], ['InvoiceDisputeDto', () => dispute()], ['PaymentAllocationDto', () => pay()]];
  for (const [cls, make] of nested) {
    cases.push({ label: `nested/${cls}/valid`, run: (mod) => h.validateDto(mod[cls], make()) });
    cases.push({ label: `nested/${cls}/empty`, run: (mod) => h.validateDto(mod[cls], {}) });
  }
  return cases;
});
