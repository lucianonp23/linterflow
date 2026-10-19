import { defineSubject } from '../harness';

// The frozen clock is Thursday 2026-01-15 12:00 UTC; the suite runs with TZ=UTC.
const day = (d: number, hh: number, mm = 0) => Date.UTC(2026, 0, d, hh, mm);

defineSubject('middleware_medium_3', (h) => {
  const base = () => ({
    method: 'POST',
    start: day(16, 10) as unknown, // Friday 10:00
    durationMin: 60 as unknown,
    format: 'iso',
    body: { providerId: 'prov-1', clientId: 'cli-1' } as Record<string, unknown>,
    noBody: false,
  });
  const inputs = h.variants(
    base,
    {
      method: ['PUT', 'PATCH', 'GET', 'DELETE', 'post'],
      start: [
        day(15, 14), day(15, 13, 59), day(15, 12), day(14, 10), day(16, 8), day(16, 7, 59), day(16, 17),
        day(16, 16, 30), day(16, 17, 59), day(17, 10), day(18, 10), day(19, 9), day(16, 23), 'not-a-date', '', null,
      ],
      durationMin: [1, 30, 59, 61, 120, 121, 0, -30, 600, 'bad', null],
      format: ['epoch', 'date-object', 'space'],
      'body.providerId': ['', null, h.DEL, 0],
      'body.clientId': ['', null, h.DEL],
      noBody: [true],
    },
    { random: 700, seed: 31 },
  );
  const fmt = (ms: number, format: string): unknown => {
    if (format === 'epoch') return ms;
    if (format === 'date-object') return new Date(ms);
    if (format === 'space') return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
    return new Date(ms).toISOString();
  };
  return inputs.map(({ label, input }) => ({
    label,
    run: (mod) => {
      const body: Record<string, unknown> = { ...input.body };
      if (typeof input.start === 'number') {
        body.startTime = fmt(input.start, input.format);
        if (typeof input.durationMin === 'number') {
          body.endTime = fmt(input.start + input.durationMin * 60000, input.format);
        } else if (input.durationMin !== null) {
          body.endTime = input.durationMin;
        }
      } else {
        body.startTime = input.start;
        body.endTime = typeof input.durationMin === 'number' ? fmt(day(16, 11) + input.durationMin * 60000, input.format) : input.durationMin;
      }
      const { req, res, next, trace } = h.http({ method: input.method, headers: {}, body: input.noBody ? undefined : body });
      const returned = new mod.AppointmentValidationMiddleware().use(req, res, next);
      return { returned, ...trace() };
    },
  }));
});
