import { defineSubject } from '../harness';

const at = (h: number, m = 0, s = 0) => Date.UTC(2026, 0, 15, h, m, s);

defineSubject('middleware_medium_1', (h) => {
  const base = () => ({
    now: at(12),
    // Offset of the x-request-timestamp header from "now", or a literal header value.
    timestamp: 'absent' as unknown,
    headers: {
      'x-region-code': 'EUROPE',
      'x-passenger-count': '2',
      'x-distance-km': '12.5',
      'x-account-status': 'ACTIVE',
      'x-ride-tier': 'ECONOMY',
    } as Record<string, unknown>,
  });
  const inputs = h.variants(
    base,
    {
      now: [at(6, 59, 59), at(7), at(8, 59, 59), at(9), at(16, 59, 59), at(17), at(18, 59, 59), at(19), at(0)],
      timestamp: [0, 299000, 300000, 300001, -300000, -300001, 'garbage', '', '2026-01-15T07:30:00Z', '2026-01-15T17:30:00.000Z'],
      'headers.x-region-code': ['NORTH_AMERICA', 'ASIA_PACIFIC', 'europe', 'MARS', '', h.DEL],
      'headers.x-passenger-count': ['1', '8', '0', '9', 'abc', '3.9', '-1', '', h.DEL, '4 people'],
      'headers.x-distance-km': ['0.1', '0.09', '1000', '1000.01', 'far', '', h.DEL, '5km', '-2'],
      'headers.x-account-status': ['SUSPENDED', 'BLOCKED', 'suspended', h.DEL, ''],
      'headers.x-ride-tier': ['COMFORT', 'LUXURY', 'VAN', 'HELICOPTER', 'economy', '', h.DEL],
    },
    { random: 500, seed: 21 },
  );
  return inputs.map(({ label, input }) => ({
    label,
    run: (mod) => {
      h.setNow(input.now);
      const headers = { ...input.headers };
      if (typeof input.timestamp === 'number') {
        headers['x-request-timestamp'] = new Date(input.now + input.timestamp).toISOString();
      } else if (input.timestamp !== 'absent') {
        headers['x-request-timestamp'] = input.timestamp;
      }
      const { req, res, next, trace } = h.http({ method: 'GET', headers });
      const returned = new mod.FareEstimationSurgeMiddleware().use(req, res, next);
      return { returned, ...trace() };
    },
  }));
});
