/**
 * dto_high_4 — multi-currency invoice reconciliation DTOs and validators.
 * Prompt: "a multi-currency invoice reconciliation (FX, rounding, tax, disputes) ... Implement
 * every rule and edge case fully and explicitly".
 *
 * Divergence under study: inside DTO validation the cross-field constraint is attached to the
 * boolean property reconciliationValidationTrigger, so it receives `true` instead of the
 * invoice. The original's two comparisons with NaN are both false (accept); the refactored
 * Math.abs(NaN) <= tolerance is false (reject).
 */
import { validateDto } from '../../harness';
import { load, freezeClock } from '../load';

const mod = load('dto_high_4');
freezeClock();

const tax = () => ({ taxType: 'VAT', ratePercent: 20, taxableAmount: 100, taxAmount: 20, taxJurisdiction: 'PT', isExempt: false });
const line = () => ({ lineId: 'L1', description: 'Consulting', quantity: 2, unitPrice: 50, discountAmount: 0, taxDetails: [tax()], netAmount: 100, grossAmount: 120 });
const pay = (o: Record<string, unknown> = {}) => ({
  paymentId: 'P1', paymentCurrency: 'USD', allocatedAmount: 120, fxRateUsed: 1, allocatedAmountInInvoiceCurrency: 120, bankFeeAmount: 0,
  bankFeeAbsorbedBySupplier: false, paymentDate: '2026-01-10T00:00:00.000Z', paymentMethod: 'WIRE', transactionReference: 'TX-1', ...o,
});
/** A self-consistent invoice: 2 x 50 + 20% VAT = 120, paid in full in the supplier currency. */
const invoice = (o: Record<string, unknown> = {}) => ({
  invoiceId: 'INV-1', invoiceNumber: '2026/0001', issueDate: '2026-01-01', dueDate: '2026-01-31',
  supplierCurrency: 'USD', customerCurrency: 'EUR', reconciliationCurrency: 'USD', roundingMode: 'HALF_UP', toleranceThreshold: 0.05,
  fxRates: [{ fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.1, effectiveDate: '2026-01-01', provider: 'ECB', invertedRate: 0.909 }],
  lineItems: [line()], payments: [pay()], disputes: [],
  totalNetAmount: 100, totalTaxAmount: 20, totalGrossAmount: 120, reconciliationValidationTrigger: true,
  ...o,
});
/** Paid 100 of 120: outside the 0.05 tolerance, so the reconciliation must fail. */
const underpaid = () => invoice({ payments: [pay({ allocatedAmount: 100, allocatedAmountInInvoiceCurrency: 100 })] });

const args = (object: unknown) => ({ object, value: undefined, constraints: [], targetName: 'InvoiceReconciliationRequestDto', property: 'reconciliationValidationTrigger' });
const direct = (o: unknown) => new mod.IsInvoiceReconciliationValidConstraint().validate(o, args(o));
const reconciliationErrors = (plain: unknown) =>
  (validateDto(mod.InvoiceReconciliationRequestDto, plain) as any).errors.filter((e: any) => e.property === 'reconciliationValidationTrigger');

describe('dto_high_4', () => {
  test('[ANCHOR] (domain) the reconciliation rule accepts a self-consistent invoice when given the invoice', () => {
    expect(direct(invoice())).toBe(true);
  });

  test('[ANCHOR] (domain) the reconciliation rule rejects an underpaid invoice when given the invoice', () => {
    expect(direct(underpaid())).toBe(false);
  });

  test('[TARGET] (domain) DTO validation (ValidationPipe) accepts a self-consistent invoice', () => {
    expect(reconciliationErrors(invoice())).toEqual([]);
  });

  test('[TARGET] (domain) DTO validation (ValidationPipe) rejects an underpaid invoice', () => {
    expect(reconciliationErrors(underpaid()).length).toBeGreaterThan(0);
  });
});
