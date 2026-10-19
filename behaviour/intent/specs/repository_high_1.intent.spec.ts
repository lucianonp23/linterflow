/**
 * repository_high_1 — telecom billing rating repository.
 * Prompt: "a telecom billing rating (call types, tiers, roaming, taxes) ... Implement every rule
 * and edge case fully and explicitly".
 *
 * Divergence under study: priority collisions are now detected with a Set in one pass. When a
 * plan has two collisions, the exception names a different one (original: the collision whose
 * first rule comes first; refactored: the collision whose second rule comes first).
 */
import { load, freezeClock, thrown } from '../load';

const mod = load('repository_high_1');
freezeClock();

let n = 0;
const rule = (callType: string, priority: number) => ({
  id: `R${++n}`, callType, destinationPrefixes: ['351'], peakStartTime: '08:00', peakEndTime: '20:00',
  peakRateMultiplier: 1, offPeakRateMultiplier: 0.5, weekendMultiplier: 0.5, holidayDates: [], holidayMultiplier: 0.5,
  pulse: '60_60', tierType: 'GRADUATED', tiers: [{ minUnits: 0, maxUnits: Infinity, ratePerUnit: 0.1, fixedFee: 0 }],
  priority, effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: new Date('2027-01-01T00:00:00Z'),
});
const plan = (rules: unknown[]) => ({ id: `PLAN-${++n}`, code: 'BASIC', name: 'Basic', defaultCurrency: 'EUR', rules, active: true });
const create = (p: unknown) => new mod.TelecomBillingRepository().createRatingPlan(p);

describe('repository_high_1', () => {
  test('[ANCHOR] (domain) a plan whose rules have distinct priorities per call type is created', () => {
    const p = plan([rule('VOICE_LOCAL', 1), rule('VOICE_LOCAL', 2), rule('SMS', 1)]);
    expect(create(p).id).toBe(p.id);
  });

  test('[TARGET] (domain) two rules with the same call type and priority are rejected', () => {
    const e = thrown(() => create(plan([rule('VOICE_LOCAL', 2), rule('VOICE_LOCAL', 2)])));
    expect(e?.constructor?.name).toBe('BadRequestException');
    expect(e.message).toBe('Priority collision (2) for call type VOICE_LOCAL');
  });

  test('[TARGET] (domain) with two collisions, the plan is rejected and the message names one of them', () => {
    const e = thrown(() => create(plan([rule('VOICE_LOCAL', 2), rule('VOICE_PREMIUM', 7), rule('VOICE_PREMIUM', 7), rule('VOICE_LOCAL', 2)])));
    expect(e?.constructor?.name).toBe('BadRequestException');
    expect(['Priority collision (2) for call type VOICE_LOCAL', 'Priority collision (7) for call type VOICE_PREMIUM']).toContain(e.message);
  });
});
