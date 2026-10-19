import { defineSubject } from '../harness';

defineSubject('middleware_medium_4', (h) => {
  const base = () => ({
    method: 'POST',
    path: '/api/exchange/trade',
    headers: { 'x-account-status': 'ACTIVE', 'x-user-tier': 'SILVER' } as Record<string, unknown>,
    body: { sourceCurrency: 'USD', targetCurrency: 'EUR', amount: 1000 } as any,
  });
  const inputs = h.variants(
    base,
    {
      method: ['GET', 'PUT', 'post'],
      path: ['/api/exchange/quote', '/exchange/trade/confirm', '/', ''],
      body: [null, undefined, {}, 'text'],
      'headers.x-market-status': ['CLOSED', 'closed', 'OPEN', ''],
      'headers.x-account-status': ['active', 'SUSPENDED', '', h.DEL, 'Active'],
      'headers.x-user-tier': ['BRONZE', 'GOLD', 'PLATINUM', 'gold', 'DIAMOND', '', h.DEL],
      'body.sourceCurrency': ['usd', 'EUR', 'GBP', 'XXX', '', null, h.DEL, 'jpy'],
      'body.targetCurrency': ['USD', 'eur', 'CHF', 'BTC', '', null, h.DEL, 'cad'],
      'body.amount': [
        0, -1, 'abc', null, h.DEL, 0.5, 1, 4.99, 5, 9.99, 10, 5000, 5000.01, 25000, 25001, 49999.99, 50000,
        100000, 100001, 1000000, 1000001, '750', '', true, [20],
      ],
    },
    { random: 900, seed: 41 },
  );
  inputs.push(
    ...h.grid(base, {
      'headers.x-user-tier': ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'],
      'body.amount': [0.5, 1, 5, 10, 5000, 5001, 25000, 25001, 49999.99, 50000, 100000, 100001, 1000000, 1000001],
    }),
  );
  return inputs.map(({ label, input }) => ({
    label,
    run: (mod) => {
      const { req, res, next, trace } = h.http(input);
      const returned = new mod.TieredSpreadExchangeMiddleware().use(req, res, next);
      return { returned, ...trace() };
    },
  }));
});
