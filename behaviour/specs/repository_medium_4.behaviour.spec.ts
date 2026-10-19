import { defineSubject } from '../harness';

const DAY = 86400000;

defineSubject('repository_medium_4', (h) => {
  const scenarios = [];
  for (let i = 0; i < 600; i++) {
    const r = h.rng(4000 + i);
    const ops: any[] = [];
    const length = 3 + r.int(22);
    for (let k = 0; k < length; k++) {
      const kind = r.pick(['create', 'create', 'accrue', 'accrue', 'accrue', 'redeem', 'redeem', 'redeem', 'status', 'delete', 'findById', 'findByCustomer', 'advance']);
      if (kind === 'create') ops.push({ kind, dto: { customerId: r.pick(['c1', 'c2', 'c3', '', '   ']), dailyRedemptionLimit: r.pick([undefined, undefined, 500, 499, 100000, 0]) } });
      else if (kind === 'accrue') ops.push({ kind, ref: r.int(4), points: r.pick([50, 100, 5000, 9999, 10000, 40000, 50000, 100000, 999999, 1000000, 1000001, 0, -5]) });
      else if (kind === 'redeem') ops.push({ kind, ref: r.int(4), points: r.pick([0, -1, 50, 99, 100, 400, 500, 501, 2500, 5000, 5001, 60000]) });
      else if (kind === 'status') ops.push({ kind, ref: r.int(4), status: r.pick(['ACTIVE', 'SUSPENDED', 'EXPIRED', 'CLOSED']) });
      else if (kind === 'delete' || kind === 'findById') ops.push({ kind, ref: r.int(4) });
      else if (kind === 'findByCustomer') ops.push({ kind, customerId: r.pick(['c1', 'c2', 'nobody']) });
      else ops.push({ kind, ms: r.pick([3600000, DAY, 2 * DAY, 180 * DAY, 181 * DAY]) });
    }
    scenarios.push({ label: `scenario-${i}`, ops });
  }

  return scenarios.map(({ label, ops }) => ({
    label,
    run: async (mod) => {
      const repo = new mod.LoyaltyRepository();
      const ids: string[] = [];
      const idFor = (ref: number) => (ref === 3 || ids.length === 0 ? 'missing' : ids[ref % ids.length]);
      const out: unknown[] = [];
      for (const op of ops) {
        switch (op.kind) {
          case 'create': {
            const res: any = await h.stepAsync(() => repo.create({ ...op.dto }));
            if (res.ok?.id) ids.push(res.ok.id);
            out.push(res);
            break;
          }
          case 'accrue':
            out.push(await h.stepAsync(() => repo.accruePoints(idFor(op.ref), op.points)));
            break;
          case 'redeem':
            out.push(await h.stepAsync(() => repo.redeemPoints(idFor(op.ref), op.points)));
            break;
          case 'status':
            out.push(await h.stepAsync(() => repo.updateStatus(idFor(op.ref), op.status)));
            break;
          case 'delete':
            out.push(await h.stepAsync(() => repo.delete(idFor(op.ref))));
            break;
          case 'findById':
            out.push(await h.stepAsync(() => repo.findById(idFor(op.ref))));
            break;
          case 'findByCustomer':
            out.push(await h.stepAsync(() => repo.findByCustomerId(op.customerId)));
            break;
          default:
            h.advance(op.ms);
            out.push({ advanced: op.ms });
        }
      }
      return out;
    },
  }));
});
