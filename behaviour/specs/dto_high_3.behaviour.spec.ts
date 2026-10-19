import { defineSubject } from '../harness';

/**
 * DECLARED SHIM. This file imports `RegisterDecorator` from class-validator. That export
 * does not exist (the real one is `registerDecorator`), so the module throws at import
 * time, in the original AND in the refactored version, with the same TypeError (see
 * results/loadability.json). Unmodified, the file has no callable behaviour to compare.
 *
 * To compare what the code would do once that one import resolves, class-validator is
 * extended here with the missing alias. The shim is identical for every arm and touches
 * nothing in the corpus. Results for this file must be reported as "executed under shim".
 */
jest.mock('class-validator', () => {
  const actual = jest.requireActual('class-validator');
  return { ...actual, RegisterDecorator: actual.registerDecorator };
});

const HOUR = 3600000;
const START = Date.UTC(2026, 2, 1, 12);

defineSubject('dto_high_3', (h) => {
  const tiers = ['STANDARD', 'SILVER', 'GOLD', 'PLATINUM', 'VIP', 'CORPORATE', 'UNKNOWN'];
  const reasons = ['CHANGE_OF_PLANS', 'MEDICAL_EMERGENCY', 'FLIGHT_DELAY_CANCELLED', 'WEATHER_EVENT', 'SERVICE_DISSATISFACTION', 'FORCE_MAJEURE', 'FRAUD_OR_SYSTEM_ERROR', 'MERCHANT_CANCELLED', 'OTHER'];
  const hoursBefore = [400, 168, 167.99, 72, 71.99, 48, 47.99, 24, 23.99, 12, 11.99, 1, 0.01, 0, -0.5, -5, -24, -24.01, -100];
  const itemTypes = ['CORE_BOOKING', 'CORE_BOOKING', 'ADD_ON', 'INSURANCE', 'DEPOSIT', 'SERVICE_FEE', 'MYSTERY'];
  const docTypes = ['MEDICAL_CERTIFICATE', 'FLIGHT_CANCEL_NOTICE', 'WEATHER_ALERT', 'POLICE_REPORT', 'OFFICIAL_DECREE'];
  const proofs: unknown[] = [
    undefined,
    null,
    { documentId: 'DOC-1', documentType: 'MEDICAL_CERTIFICATE', issuedAt: '2026-02-20T00:00:00.000Z', fileUrl: 'https://x/doc', verifiedByAdmin: true },
    { documentId: 'DOC-1', documentType: 'MEDICAL_CERTIFICATE', issuedAt: '2026-02-20T00:00:00.000Z', fileUrl: 'https://x/doc', verifiedByAdmin: false },
    ...docTypes.slice(1).map((documentType) => ({ documentId: 'DOC-2', documentType, issuedAt: '2026-02-20T00:00:00.000Z', fileUrl: 'u', verifiedByAdmin: true })),
    { documentId: '', documentType: 'MEDICAL_CERTIFICATE', issuedAt: '2026-02-20T00:00:00.000Z' },
    { documentId: 'DOC-3', documentType: '', issuedAt: '2026-02-20T00:00:00.000Z' },
    { documentId: 'DOC-3', documentType: 'WEATHER_ALERT' },
    { documentId: 7, documentType: 'NOPE', issuedAt: 'not-a-date', fileUrl: 9, verifiedByAdmin: 'yes' },
  ];

  const cases: { label: string; run: (mod: any) => unknown }[] = [];

  // 1. The penalty engine, driven with typed requests (Date objects), as a caller would after validation.
  for (let i = 0; i < 5000; i++) {
    const r = h.rng(9000 + i);
    const lineItems = [];
    const n = 1 + r.int(4);
    for (let k = 0; k < n; k++) {
      lineItems.push({
        itemId: `item-${k}`,
        itemType: r.pick(itemTypes),
        amount: r.pick([0, 80, 100, 250.55, 1200, 33.335]),
        taxAmount: r.pick([0, 0, 23, 57.63]),
        isNonRefundableOverride: r.chance(0.12),
        customNonRefundableFee: r.pick([undefined, undefined, 0, 50, 5000]),
      });
    }
    const recipe = {
      customerTier: r.pick(tiers),
      cancellationReason: r.pick(reasons),
      hours: r.pick(hoursBefore),
      isPeakSeason: r.chance(0.4),
      requestedStoreCredit: r.chance(0.4),
      priorRefundAmount: r.pick([0, 0, 0, 25, 100000]),
      proof: r.pick(proofs.slice(0, 4)) as any,
      lineItems,
    };
    cases.push({
      label: `engine/${i}`,
      run: (mod) =>
        new mod.CancellationPenaltyEngine().calculateCancellation({
          bookingId: 'BK-1',
          customerId: 'CU-1',
          customerTier: recipe.customerTier,
          cancellationReason: recipe.cancellationReason,
          currency: 'EUR',
          bookingTimestamp: new Date(START - 900 * HOUR),
          serviceStartTimestamp: new Date(START),
          cancellationTimestamp: new Date(START - recipe.hours * HOUR),
          isPeakSeason: recipe.isPeakSeason,
          requestedStoreCredit: recipe.requestedStoreCredit,
          priorRefundAmount: recipe.priorRefundAmount,
          lineItems: recipe.lineItems.map((li) => ({ ...li })),
          proofDocument: recipe.proof ? { ...recipe.proof, issuedAt: new Date(recipe.proof.issuedAt) } : recipe.proof,
        }),
    });
  }

  // 2. The request DTO, through transformation + validation.
  const item = (o: Record<string, unknown> = {}) => ({ itemId: 'i1', itemType: 'CORE_BOOKING', amount: 500, taxAmount: 50, isNonRefundableOverride: false, ...o });
  const basePlain = () => ({
    bookingId: 'BK-1',
    customerId: 'CU-1',
    customerTier: 'GOLD',
    cancellationReason: 'CHANGE_OF_PLANS',
    currency: 'EUR',
    bookingTimestamp: '2026-01-01T10:00:00.000Z',
    serviceStartTimestamp: '2026-03-01T12:00:00.000Z',
    cancellationTimestamp: '2026-02-20T12:00:00.000Z',
    isPeakSeason: false,
    requestedStoreCredit: false,
    priorRefundAmount: 0,
    lineItems: [item()] as any,
    proofDocument: undefined as any,
  });
  const plainPools = {
    bookingId: [7, h.DEL],
    customerTier: tiers.slice(0, 6).concat(['NOPE']),
    cancellationReason: reasons,
    currency: ['USD', 'BTC'],
    bookingTimestamp: ['2026-03-05T10:00:00.000Z', 'garbage', h.DEL, 1767261600000],
    serviceStartTimestamp: ['2025-12-01T00:00:00.000Z', '2026-01-01T10:00:00.000Z', 'garbage', h.DEL],
    cancellationTimestamp: ['2025-12-31T00:00:00.000Z', '2026-03-02T00:00:00.000Z', null],
    isPeakSeason: ['true', h.DEL],
    requestedStoreCredit: [1],
    priorRefundAmount: [-1, 499.99, 500, 550, '0', h.DEL],
    lineItems: [
      [],
      null,
      'x',
      [item({ itemType: 'ADD_ON' })],
      [item({ amount: -5 })],
      [item({ amount: '500' })],
      [item(), item({ itemId: 'i2', itemType: 'INSURANCE', amount: 60, taxAmount: 0 })],
      [item({ itemId: 9, itemType: 'NOPE', taxAmount: -1, isNonRefundableOverride: 'no', customNonRefundableFee: -3 })],
      [item({ customNonRefundableFee: 25 })],
    ],
    proofDocument: proofs,
  };
  for (const { label, input } of h.variants(basePlain, plainPools, { random: 2500, maxK: 6, seed: 91 })) {
    cases.push({ label: `dto/${label}`, run: (mod) => h.validateDto(mod.CancellationRequestDto, input) });
  }
  cases.push({ label: 'dto/nested-line-empty', run: (mod) => h.validateDto(mod.BookingLineItemDto, {}) });
  cases.push({ label: 'dto/nested-proof-empty', run: (mod) => h.validateDto(mod.DocumentProofDto, {}) });

  // 3. The three custom constraints, called directly.
  const args = (object: unknown, constraints: unknown[] = []) => ({ object, constraints, property: 'serviceStartTimestamp', value: undefined, targetName: 'CancellationRequestDto' });
  const dates: unknown[] = [new Date('2026-01-01T10:00:00Z'), new Date('2026-01-01T10:00:00.001Z'), new Date('2025-01-01T00:00:00Z'), '2026-01-02', null, undefined, 5];
  dates.forEach((a, i) =>
    dates.forEach((b, j) =>
      cases.push({
        label: `after-date/${i}-${j}`,
        run: (mod) => {
          const c = new mod.IsAfterDateConstraint();
          const ctx = args({ bookingTimestamp: b }, ['bookingTimestamp']);
          return { valid: c.validate(a, ctx), message: c.defaultMessage(ctx) };
        },
      }),
    ),
  );
  reasons.forEach((reason, i) =>
    proofs.forEach((proof, j) =>
      cases.push({
        label: `proof-for-reason/${i}-${j}`,
        run: (mod) => {
          const c = new mod.IsValidProofForReasonConstraint();
          const ctx = args({ cancellationReason: reason });
          return { valid: c.validate(proof, ctx), message: c.defaultMessage(ctx) };
        },
      }),
    ),
  );
  const itemSets: unknown[] = [...plainPools.lineItems, undefined, [item({ amount: 0 })], [item({ itemType: 'DEPOSIT' }), item({ itemType: 'SERVICE_FEE' })]];
  itemSets.forEach((items, i) =>
    [undefined, 0, 100, 500, 499.99, 10000].forEach((prior, j) =>
      cases.push({
        label: `line-item-sum/${i}-${j}`,
        run: (mod) => {
          const c = new mod.IsLineItemSumValidConstraint();
          return { valid: c.validate(items, args({ priorRefundAmount: prior })), message: c.defaultMessage() };
        },
      }),
    ),
  );
  return cases;
});
