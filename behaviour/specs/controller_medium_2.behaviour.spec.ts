import { defineSubject } from '../harness';

// The reservations live in a module-level array, so every scenario gets a fresh module.
defineSubject(
  'controller_medium_2',
  (h) => {
    const checkIns = ['2026-01-15', '2026-01-14', '2026-01-16', '2026-01-20', '2026-01-22', '2026-02-01', 'nope'];
    const nights = [1, 2, 3, 0, -1, 30, 31, 7];
    const rooms = ['101', '101', '102', '201', '999', ''];
    const guests = [1, 2, 5, 0, 6, -1];
    const amounts = [100, 250.5, 0, -5, 1];
    const plusDays = (iso: string, n: number) => {
      const t = new Date(iso).getTime();
      return Number.isNaN(t) ? iso : new Date(t + n * 86400000).toISOString().slice(0, 10);
    };

    const scenarios = [];
    for (let i = 0; i < 400; i++) {
      const r = h.rng(1000 + i);
      const dto = (valid: boolean) => {
        const checkIn = valid ? r.pick(['2026-01-16', '2026-01-20', '2026-01-22', '2026-02-01']) : r.pick(checkIns);
        return {
          roomId: valid ? r.pick(['101', '102', '201']) : r.pick(rooms),
          guestId: `guest-${r.int(3)}`,
          checkInDate: checkIn,
          checkOutDate: plusDays(checkIn, valid ? r.pick([1, 2, 3, 7]) : r.pick(nights)),
          numberOfGuests: valid ? r.pick([1, 2, 5]) : r.pick(guests),
          totalAmount: valid ? r.pick([100, 250.5]) : r.pick(amounts),
        };
      };
      const ops: any[] = [];
      const length = 2 + r.int(9);
      for (let k = 0; k < length; k++) {
        const kind = r.pick(['create', 'create', 'create', 'createValid', 'createValid', 'update', 'update', 'cancel', 'cancel', 'findOne', 'findAll', 'advance']);
        if (kind === 'create') ops.push({ kind, dto: dto(false) });
        else if (kind === 'createValid') ops.push({ kind: 'create', dto: dto(true) });
        else if (kind === 'update') ops.push({ kind, ref: r.int(4), dto: dto(r.chance(0.6)) });
        else if (kind === 'cancel' || kind === 'findOne') ops.push({ kind, ref: r.int(4) });
        else if (kind === 'findAll') ops.push({ kind, roomId: r.pick([undefined, '101', '102', '999']) });
        else ops.push({ kind, days: r.pick([1, 5, 20]) });
      }
      scenarios.push({ label: `scenario-${i}`, ops });
    }

    return scenarios.map(({ label, ops }) => ({
      label,
      run: (mod) => {
        const controller = new mod.ReservationsController();
        const ids: string[] = [];
        const idFor = (ref: number) => (ids.length === 0 || ref === 3 ? 'missing-id' : ids[ref % ids.length]);
        return ops.map((op: any) => {
          switch (op.kind) {
            case 'create': {
              const out: any = h.step(() => controller.create({ ...op.dto }));
              if (out.ok?.id) ids.push(out.ok.id);
              return out;
            }
            case 'update':
              return h.step(() => controller.update(idFor(op.ref), { ...op.dto }));
            case 'cancel':
              return h.step(() => controller.cancel(idFor(op.ref)));
            case 'findOne':
              return h.step(() => controller.findOne(idFor(op.ref)));
            case 'findAll':
              return h.step(() => controller.findAll(op.roomId));
            default:
              h.advance(op.days * 86400000);
              return { advanced: op.days };
          }
        });
      },
    }));
  },
  { freshModule: true },
);
