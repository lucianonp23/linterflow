import { defineSubject } from '../harness';

defineSubject('repository_medium_3', (h) => {
  const titles = ['Printer on fire', 'Cannot log in to portal', 'abc', '    ab    ', 'x'.repeat(120), 'x'.repeat(121), '', '  padded title  '];
  const descriptions = ['The device stopped responding after the update.', 'too short', '   123456789   ', '', '  a perfectly fine description  '];
  const customers = ['c1', 'c1', 'c1', 'c2', '', '   '];
  const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'WEIRD'];
  const categories = ['BILLING', 'TECHNICAL', 'GENERAL', 'CRITICAL_INFRA'];
  const tagSets: unknown[] = [undefined, [], ['vip'], ['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e', 'f'], ['ok', 'SYS_internal']];
  const statuses = [undefined, 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'];

  const scenarios = [];
  for (let i = 0; i < 600; i++) {
    const r = h.rng(3000 + i);
    const createDto = (valid: boolean) => ({
      id: r.chance(0.15) ? r.pick(['T-1', 'T-2']) : undefined,
      customerId: valid ? r.pick(['c1', 'c1', 'c2']) : r.pick(customers),
      title: valid ? r.pick(titles.slice(0, 2)) : r.pick(titles),
      description: valid ? descriptions[0] : r.pick(descriptions),
      priority: valid ? r.pick(priorities.slice(0, 3)) : r.pick(priorities),
      category: r.pick(categories),
      assigneeId: r.chance(0.3) ? 'agent-7' : undefined,
      tags: valid ? r.pick(tagSets.slice(0, 4)) : r.pick(tagSets),
    });
    const updateDto = () => {
      const dto: Record<string, unknown> = {};
      if (r.chance(0.3)) dto.title = r.pick(['  New title  ', '']);
      if (r.chance(0.3)) dto.description = r.pick(['  New description text  ', '']);
      if (r.chance(0.4)) dto.priority = r.pick(priorities);
      if (r.chance(0.6)) dto.status = r.pick(statuses);
      if (r.chance(0.2)) dto.category = r.pick(categories);
      if (r.chance(0.3)) dto.assigneeId = r.pick(['agent-1', '', undefined]);
      if (r.chance(0.3)) dto.tags = r.pick(tagSets);
      if (r.chance(0.3)) dto.slaBreached = r.pick([true, false, undefined]);
      return dto;
    };
    const ops: any[] = [];
    const length = 3 + r.int(22);
    for (let k = 0; k < length; k++) {
      const kind = r.pick(['createValid', 'createValid', 'createValid', 'create', 'update', 'update', 'update', 'delete', 'findById', 'findAll', 'pop', 'pop', 'advance']);
      if (kind === 'createValid') ops.push({ kind: 'create', dto: createDto(true) });
      else if (kind === 'create') ops.push({ kind, dto: createDto(false) });
      else if (kind === 'update') ops.push({ kind, ref: r.int(7), dto: updateDto() });
      else if (kind === 'delete' || kind === 'findById') ops.push({ kind, ref: r.int(7) });
      else if (kind === 'pop') ops.push({ kind, agent: r.pick(['agent-1', 'agent-2', '', '  ']), categories: r.pick([undefined, [], ['BILLING'], ['TECHNICAL', 'CRITICAL_INFRA'], ['GENERAL']]) });
      else if (kind === 'advance') ops.push({ kind, ms: r.pick([1000, 60000]) });
      else ops.push({ kind });
    }
    scenarios.push({ label: `scenario-${i}`, ops });
  }

  return scenarios.map(({ label, ops }) => ({
    label,
    run: (mod) => {
      const repo = new mod.SupportTicketRepository();
      const ids: string[] = [];
      const idFor = (ref: number) => (ref === 5 ? 'missing' : ref === 6 ? '  ' : ids.length ? ids[ref % ids.length] : 'missing');
      return ops.map((op: any) => {
        switch (op.kind) {
          case 'create': {
            const out: any = h.step(() => repo.create({ ...op.dto }));
            if (out.ok?.id) ids.push(out.ok.id);
            return out;
          }
          case 'update':
            return h.step(() => repo.update(idFor(op.ref), { ...op.dto }));
          case 'delete':
            return h.step(() => repo.delete(idFor(op.ref)));
          case 'findById':
            return h.step(() => repo.findById(idFor(op.ref)));
          case 'findAll':
            return h.step(() => repo.findAll());
          case 'pop':
            return h.step(() => repo.popNextPriorityTicket(op.agent, op.categories));
          default:
            h.advance(op.ms);
            return { advanced: op.ms };
        }
      });
    },
  }));
});
