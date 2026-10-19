import { defineSubject } from '../harness';

const DAY = 86400000;

defineSubject('controller_high_1', (h) => {
  const flagsPool = [
    [], [], [],
    ['SUSPICIOUS_LOCATION'], ['RECENT_POLICY_CHANGE'], ['HIGH_FREQUENCY_CLAIMS'], ['DUPLICATE_RECEIPT'], ['UNLICENSED_PROVIDER'], ['BLACK_LISTED_IP'],
    ['SUSPICIOUS_LOCATION', 'RECENT_POLICY_CHANGE'], ['BLACK_LISTED_IP', 'DUPLICATE_RECEIPT'], ['UNKNOWN_FLAG'],
  ];
  const baseRecipe = () => ({
    policyNumber: 'POL-1' as unknown,
    customerId: 'C1' as unknown,
    customerTier: 'GOLD' as unknown,
    claimType: 'HEALTH' as unknown,
    amount: 800 as unknown,
    incidentDaysAgo: 10 as unknown,
    filingDaysAgo: 5 as unknown,
    lines: 'single',
    category: 'CONSULT',
    fraudFlags: [] as unknown,
  });
  const recipePools = {
    policyNumber: ['', h.DEL],
    customerId: ['', h.DEL],
    customerTier: ['BRONZE', 'SILVER', 'PLATINUM', 'DIAMOND', 'IRON', h.DEL],
    claimType: ['AUTO', 'HOME', 'TRAVEL', 'LIFE', 'PET', h.DEL],
    amount: [0, -1, 400, 499, 500, 501, 1000, 1001, 2000, 2001, 3000, 4999, 5001, 10000, 10001, 12000, 20001, 60000, 250000, 3000000],
    incidentDaysAgo: [0, 5, 36, 40, 96, 100, 200, -1, 'bad'],
    filingDaysAgo: [0, 3, 5, 6, 8, 9, 35, -1, 'bad', 12, 250],
    lines: ['none', 'empty', 'split', 'mismatch', 'negative', 'no-ids', 'close-enough'],
    category: ['COSMETIC', 'RACING', 'WEAR_AND_TEAR'],
    fraudFlags: flagsPool.slice(3).concat([undefined as any]),
  };
  const toDto = (recipe: any) => {
    const date = (d: unknown) => (typeof d === 'number' ? new Date(h.NOW - d * DAY).toISOString() : d);
    const amount = typeof recipe.amount === 'number' ? recipe.amount : 0;
    const li = (id: string | undefined, value: number, category = recipe.category) => ({ id, description: `Item ${id}`, amount: value, category });
    const lineItems: Record<string, unknown> = {
      none: undefined,
      empty: [],
      single: [li('a', amount)],
      split: [li('a', amount * 0.25), li('b', amount * 0.75, 'CONSULT')],
      mismatch: [li('a', amount + 5)],
      negative: [li('a', -amount), li('b', amount * 2)],
      'no-ids': [li(undefined, amount / 2), li('', amount / 2)],
      'close-enough': [li('a', amount + 0.01)],
    };
    const { incidentDaysAgo, filingDaysAgo, lines, category, ...rest } = recipe;
    return { ...rest, dateOfIncident: date(incidentDaysAgo), filingDate: date(filingDaysAgo), description: 'Claim under test', lineItems: lineItems[lines] };
  };

  const cases: { label: string; run: (mod: any) => unknown }[] = [];
  for (const { label, input } of h.variants(baseRecipe, recipePools, { random: 4000, maxK: 7, seed: 121 })) {
    cases.push({ label: `create/${label}`, run: (mod) => new mod.InsuranceClaimsController().createAndEvaluateClaim(toDto(input)) });
  }

  for (let i = 0; i < 3000; i++) {
    const r = h.rng(12000 + i);
    const creates = [h.mutated(baseRecipe, recipePools, r, 3)];
    if (r.chance(0.3)) creates.push(h.mutated(baseRecipe, recipePools, r, 2));
    const ops: any[] = [];
    const length = 2 + r.int(9);
    for (let k = 0; k < length; k++) {
      const kind = r.pick(['get', 'reevaluate', 'reevaluate', 'review', 'review', 'review', 'cancel', 'advance']);
      const ref = r.int(3);
      if (kind === 'get') ops.push({ kind, ref, stats: r.pick([undefined, 'true', 'false']) });
      else if (kind === 'reevaluate') {
        const dto: any = {};
        if (r.chance(0.4)) dto.forceReevaluation = r.pick([true, false]);
        if (r.chance(0.5)) dto.additionalFraudFlags = r.pick(flagsPool);
        if (r.chance(0.5)) {
          dto.updatedLineItems = r.pick([
            [],
            [{ id: 'n1', description: 'new', amount: 300, category: 'CONSULT' }],
            [{ id: 'n1', description: 'new', amount: 15000, category: 'CONSULT' }, { id: 'n2', description: 'x', amount: 50, category: 'RACING', flagged: true }],
            [{ id: 'n1', description: 'new', amount: 700, category: 'COSMETIC' }],
            [{ id: 'n1', description: 'new', amount: 700, category: 'WEAR_AND_TEAR', flagged: false }],
            [{ id: 'n1', description: 'bad', amount: 0, category: 'CONSULT' }],
            [{ id: 'n1', description: 'ok', amount: 200, category: 'CONSULT', flagged: true }, { id: 'n2', description: 'ok', amount: 11000, category: 'CONSULT' }],
          ]);
        }
        ops.push({ kind, ref, dto });
      } else if (kind === 'review') {
        ops.push({
          kind,
          ref,
          dto: {
            adjusterId: r.pick(['adj-1', 'adj-1', 'adj-1', '']),
            adjusterLevel: r.pick([1, 2, 3, 4, 4, 5, 0]),
            decision: r.pick(['APPROVE', 'APPROVE', 'APPROVE', 'REJECT', 'ESCALATE', 'HOLD', undefined]),
            overrideAmount: r.pick([undefined, undefined, 0, 100, 6000, 30000, 150000, -1, 99999999]),
            reason: r.pick(['Reviewed documents', 'Reviewed documents', '']),
            mitigationNotes: r.pick([undefined, [], ['one'], ['one', 'two']]),
          },
        });
      } else if (kind === 'cancel') ops.push({ kind, ref, reason: r.pick([undefined, 'Customer request', '']) });
      else ops.push({ kind, days: r.pick([1, 3, 20, 40]) });
    }
    cases.push({
      label: `scenario/${i}`,
      run: (mod) => {
        const controller = new mod.InsuranceClaimsController();
        const ids: string[] = [];
        const trace: unknown[] = creates.map((recipe) => {
          const out: any = h.step(() => controller.createAndEvaluateClaim(toDto(recipe)));
          if (out.ok?.id) ids.push(out.ok.id);
          return out;
        });
        const idFor = (ref: number) => (ref === 2 || ids.length === 0 ? 'CLM-missing' : ids[ref % ids.length]);
        for (const op of ops) {
          if (op.kind === 'get') trace.push(h.step(() => controller.getClaimById(idFor(op.ref), op.stats)));
          else if (op.kind === 'reevaluate') trace.push(h.step(() => controller.reevaluateClaim(idFor(op.ref), JSON.parse(JSON.stringify(op.dto)))));
          else if (op.kind === 'review') trace.push(h.step(() => controller.manualReview(idFor(op.ref), { ...op.dto })));
          else if (op.kind === 'cancel') trace.push(h.step(() => controller.cancelOrDeleteClaim(idFor(op.ref), op.reason)));
          else {
            h.advance(op.days * DAY);
            trace.push({ advanced: op.days });
          }
        }
        return trace;
      },
    });
  }
  return cases;
});
