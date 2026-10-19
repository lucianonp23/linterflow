import { defineSubject } from '../harness';

defineSubject('repository_high_1', (h) => {
  const d = (day: number, hour = 0, minute = 0, second = 0) => new Date(Date.UTC(2026, 0, day, hour, minute, second));
  const callTypes = ['VOICE_LOCAL', 'VOICE_LOCAL', 'VOICE_NATIONAL', 'VOICE_INTL', 'VOICE_PREMIUM', 'VOICE_TOLLFREE', 'SMS', 'MMS', 'DATA', 'DATA'];
  const tierSets = [
    [{ minUnits: 0, maxUnits: Infinity, ratePerUnit: 0.01, fixedFee: 0 }],
    [{ minUnits: 0, maxUnits: 60, ratePerUnit: 0.02, fixedFee: 0.1 }, { minUnits: 60, maxUnits: 600, ratePerUnit: 0.01, fixedFee: 0 }, { minUnits: 600, maxUnits: Infinity, ratePerUnit: 0.005, fixedFee: 0.05 }],
    [{ minUnits: 60, maxUnits: 1000, ratePerUnit: 0.01, fixedFee: 0 }, { minUnits: 0, maxUnits: 60, ratePerUnit: 0.03, fixedFee: 0 }],
    [{ minUnits: 0, maxUnits: 100, ratePerUnit: 0.000001, fixedFee: 0.2 }, { minUnits: 100, maxUnits: 5000000, ratePerUnit: 0.0000005, fixedFee: 0 }],
  ];
  const badTierSets: unknown[] = [
    [],
    undefined,
    [{ minUnits: 5, maxUnits: 60, ratePerUnit: 0.01, fixedFee: 0 }],
    [{ minUnits: 0, maxUnits: 0, ratePerUnit: 0.01, fixedFee: 0 }],
    [{ minUnits: 0, maxUnits: 60, ratePerUnit: -1, fixedFee: 0 }],
    [{ minUnits: 0, maxUnits: 60, ratePerUnit: 0.01, fixedFee: -1 }],
    [{ minUnits: 0, maxUnits: 60, ratePerUnit: 0.01, fixedFee: 0 }, { minUnits: 90, maxUnits: 600, ratePerUnit: 0.01, fixedFee: 0 }],
    [{ minUnits: 0, maxUnits: 60, ratePerUnit: 0.01, fixedFee: 0 }, { minUnits: 60, maxUnits: 30, ratePerUnit: 0.01, fixedFee: 0 }],
  ];

  const scenarios = [];
  for (let i = 0; i < 4500; i++) {
    const r = h.rng(18000 + i);
    const rule = (id: string, valid: boolean) => ({
      id,
      callType: r.pick(callTypes),
      destinationPrefixes: r.pick([[], [], ['+351'], ['+3512', '+44'], ['+1']]),
      peakStartTime: r.pick(['08:00', '08:00', '18:00', '00:00']),
      peakEndTime: r.pick(['20:00', '20:00', '22:00', '23:59']),
      peakRateMultiplier: valid ? r.pick([1, 1.5, 2]) : r.pick([1.5, -1]),
      offPeakRateMultiplier: r.pick([1, 0.5, 0.8]),
      weekendMultiplier: r.pick([1, 0.7, 1.2]),
      holidayDates: r.pick([[], [], ['2026-01-15'], ['2026-01-17', '2026-01-16']]),
      holidayMultiplier: valid ? r.pick([1, 2]) : r.pick([2, -0.5]),
      pulse: r.pick(['1_1', '60_60', '30_60', '10_10', '1024_1024', 'OTHER']),
      tierType: r.pick(['GRADUATED', 'GRADUATED', 'FLAT_VOLUME']),
      tiers: valid ? r.pick(tierSets) : r.chance(0.6) ? r.pick(badTierSets) : r.pick(tierSets),
      priority: r.pick([1, 2, 3, 4, 5, 6, 7, 8]),
      effectiveFrom: valid ? d(1) : r.pick([d(1), d(20), d(31)]),
      effectiveTo: valid ? r.pick([d(31), d(31), d(16)]) : r.pick([d(31), d(1)]),
    });
    const plan = (id: string, valid: boolean) => {
      const rules = [];
      const n = 1 + r.int(5);
      for (let k = 0; k < n; k++) rules.push(rule(`${id}-rule-${k}`, valid));
      return { id, code: valid ? `CODE-${id}` : r.pick([`CODE-${id}`, '', '   ']), name: 'Plan', defaultCurrency: 'EUR', rules: valid || r.chance(0.9) ? rules : (r.pick([undefined, 'x']) as any), active: !r.chance(0.08) };
    };
    const ops: any[] = [{ kind: 'createPlan', plan: plan('PL1', true) }];
    if (r.chance(0.4)) ops.push({ kind: 'createPlan', plan: plan(r.pick(['PL1', 'PL2']), r.chance(0.5)) });
    const matrixCount = r.int(3);
    for (let k = 0; k < matrixCount; k++) {
      ops.push({ kind: 'createMatrix', matrix: { id: r.pick(['RM1', 'RM2']), homeMccMnc: r.pick(['26801', '26801', '2680', 'abcde']), visitedMccMnc: r.pick(['21407', '21407', '310260', '1234567']), zoneName: 'EU', voiceSurchargePerMin: r.pick([0.1, 0.5, -1]), dataSurchargePerMb: r.pick([0.05, 2]), smsSurcharge: r.pick([0.06, 0.2]), mmsSurcharge: 0.3, penaltyMultiplier: r.pick([1, 1.5, 0.5]), active: !r.chance(0.2) } });
    }
    const taxCount = r.int(4);
    for (let k = 0; k < taxCount; k++) {
      ops.push({ kind: 'createTax', tax: { id: r.pick(['TX1', 'TX2', 'TX3']), code: r.pick(['VAT23', 'USF', 'E911']), taxType: r.pick(['VAT', 'STATE', 'FEDERAL', 'USF', 'E911']), percentage: r.pick([23, 6, 2.5, 0, 100, 101, -1]), isCompound: r.chance(0.35), appliesToCallTypes: r.pick([[], [], ['DATA'], ['VOICE_LOCAL', 'SMS']]), exemptAccountTypes: r.pick([[], [], ['GOVERNMENT']]), effectiveFrom: r.pick([d(1), d(1), d(20)]), effectiveTo: r.pick([d(31), d(31), d(1), d(10)]), active: !r.chance(0.15) } });
    }
    const accountCount = 1 + r.int(2);
    for (let k = 0; k < accountCount; k++) {
      const buckets = [];
      const b = r.int(3);
      for (let x = 0; x < b; x++) buckets.push({ bucketId: `B${x}`, callType: r.pick(callTypes), remainingUnits: r.pick([0, 30, 600, 100000]), totalUnits: 100000, expiresAt: r.pick([d(31), d(31), d(10)]) });
      ops.push({ kind: 'createAccount', account: { id: r.pick(['A1', 'A1', 'A2']), accountNumber: '900100', ratingPlanId: r.pick(['PL1', 'PL1', 'PL2', 'PL9']), homeMccMnc: '26801', accountType: r.pick(['CONSUMER', 'BUSINESS', 'GOVERNMENT']), currency: 'EUR', creditLimit: r.pick([1000, 1000, 5, 0.5]), currentBalance: r.pick([0, 0, 4.9, 999]), buckets, isTaxExempt: r.chance(0.15), exemptTaxCodes: r.pick([[], [], ['USF'], ['VAT23']]), active: !r.chance(0.1) } });
    }
    const length = 4 + r.int(14);
    for (let k = 0; k < length; k++) {
      const kind = r.pick(['createCdr', 'createCdr', 'createCdr', 'createCdr', 'rate', 'rate', 'rate', 'rateAll', 'bucket', 'updatePlan', 'deletePlan', 'read', 'summary', 'advance']);
      if (kind === 'createCdr') {
        const callType = r.pick(callTypes);
        ops.push({ kind, cdr: { id: `CDR${r.int(6)}`, accountId: r.pick(['A1', 'A1', 'A1', 'A2', 'A9']), callType, originatingNumber: '+351910000000', destinationNumber: r.pick(['+351210000000', '+351210000000', '+447000000000', '+12025550100', '800123']), originMccMnc: r.pick(['26801', '26801', '21407']), visitedMccMnc: r.pick(['26801', '26801', '21407', '310260', '99999']), startTime: r.pick([d(15, 12), d(15, 7, 59, 30), d(15, 19, 59, 0), d(15, 23, 58, 0), d(16, 23, 59, 59), d(17, 10), d(18, 23, 50), d(25, 9), d(15, 12, 0, 0)]), durationSeconds: r.pick([0, 1, 29, 30, 31, 59, 60, 61, 125, 600, 3700, 90000, -5]), dataVolumeBytes: callType === 'DATA' ? r.pick([0, 500, 1024, 1025, 5000000, 800000000]) : r.pick([0, 0, -1]), status: r.pick(['NEW', 'RATED', 'FAILED']) } });
      } else if (kind === 'rate') ops.push({ kind, id: `CDR${r.int(7)}` });
      else if (kind === 'bucket') ops.push({ kind, accountId: r.pick(['A1', 'A2', 'A9']), bucket: { bucketId: `BX${k}`, callType: r.pick(callTypes), remainingUnits: r.pick([120, 5000000]), totalUnits: 5000000, expiresAt: r.pick([d(31), d(14)]) } });
      else if (kind === 'updatePlan') ops.push({ kind, id: r.pick(['PL1', 'PL2', 'PL9']), updated: r.pick([{ active: false }, { active: true }, { code: '' }, { name: 'Renamed', id: 'IGNORED' }, { rules: [] }, { rules: [rule('new-rule', true), rule('new-rule-2', r.chance(0.5))] }]) });
      else if (kind === 'deletePlan') ops.push({ kind, id: r.pick(['PL1', 'PL2', 'PL9']) });
      else if (kind === 'advance') ops.push({ kind, ms: r.pick([1000, 86400000, 20 * 86400000]) });
      else ops.push({ kind, id: r.pick(['A1', 'A2']) });
    }
    scenarios.push({ label: `scenario-${i}`, ops });
  }

  // Every scenario needs its own copies: the repository stores and mutates what it is given.
  const copy = (v: any): any => {
    if (v instanceof Date) return new Date(v.getTime());
    if (Array.isArray(v)) return v.map(copy);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)]));
    return v;
  };

  return scenarios.map(({ label, ops }) => ({
    label,
    run: async (mod) => {
      const repo = new mod.TelecomBillingRepository();
      const out: unknown[] = [];
      for (const raw of ops) {
        const op = copy(raw);
        switch (op.kind) {
          case 'createPlan': out.push(h.step(() => repo.createRatingPlan(op.plan))); break;
          case 'createMatrix': out.push(h.step(() => repo.createRoamingMatrix(op.matrix))); break;
          case 'createTax': out.push(h.step(() => repo.createTaxRate(op.tax))); break;
          case 'createAccount': out.push(h.step(() => repo.createAccount(op.account))); break;
          case 'createCdr': out.push(h.step(() => repo.createCdr(op.cdr))); break;
          case 'rate': out.push(await h.stepAsync(() => repo.rateCallDetailRecord(op.id))); out.push(h.step(() => repo.getCdr(op.id))); break;
          case 'rateAll': out.push(await h.stepAsync(() => repo.rateAllPendingCdrs())); break;
          case 'bucket': out.push(h.step(() => repo.addAccountBucket(op.accountId, op.bucket))); break;
          case 'updatePlan': out.push(h.step(() => repo.updateRatingPlan(op.id, op.updated))); break;
          case 'deletePlan': out.push(h.step(() => repo.deleteRatingPlan(op.id))); break;
          case 'summary': out.push(h.step(() => ({ summary: repo.getAccountRevenueSummary(op.id), records: repo.getRatedRecordsForAccount(op.id) }))); break;
          case 'advance': h.advance(op.ms); out.push({ advanced: op.ms }); break;
          default:
            out.push(h.step(() => repo.getAccount(op.id)));
            out.push(h.step(() => repo.getRatingPlan('PL1')));
            out.push(h.step(() => repo.getRoamingMatrix('RM1')));
            out.push(h.step(() => repo.getTaxRate('TX1')));
        }
      }
      return out;
    },
  }));
});
