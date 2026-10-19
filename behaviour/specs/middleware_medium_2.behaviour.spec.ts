import { defineSubject } from '../harness';

defineSubject('middleware_medium_2', (h) => {
  const base = () => ({
    method: 'POST',
    headers: { 'x-supplier-id': 'SUP-1' } as Record<string, unknown>,
    body: { itemId: 'ITEM-1', quantity: 50, currentStock: 5, reorderThreshold: 20, supplierId: 'SUP-2' } as any,
  });
  const inputs = h.variants(
    base,
    {
      method: ['GET', 'PUT', 'DELETE', 'PATCH', 'post'],
      body: [null, undefined, 'text', 42, [], {}],
      'body.itemId': ['', '   ', 7, null, h.DEL, ' padded '],
      'body.quantity': [0, -3, 1.5, '50', 1, 10000, 10001, null, h.DEL, NaN],
      'body.currentStock': [20, 21, 0, '30', h.DEL],
      'body.reorderThreshold': [4, 5, 100, '1', h.DEL],
      'body.supplierId': [h.DEL, '', null],
      'headers.x-supplier-id': [h.DEL, ''],
      'headers.x-warehouse-status': ['MAINTENANCE', 'FULL', 'OPEN', 'maintenance'],
    },
    { random: 300, seed: 11 },
  );
  return inputs.map(({ label, input }) => ({
    label,
    run: (mod) => {
      const { req, res, next, trace } = h.http(input);
      const returned = new mod.InventoryRestockMiddleware().use(req, res, next);
      return { returned, ...trace() };
    },
  }));
});
