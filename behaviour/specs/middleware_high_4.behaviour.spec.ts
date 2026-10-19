import { defineSubject } from '../harness';

// Only use() is exported behaviour. The policy store is a private, fixed field, so the
// condition operators no built-in rule uses are unreachable from outside by construction.
defineSubject('middleware_high_4', (h) => {
  const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 0, day, hour, minute);
  const future = h.NOW + 3600000;
  const base = () => ({
    now: at(15, 12), // Thursday
    method: 'GET',
    path: '/projects/p1',
    query: {} as any,
    params: {} as any,
    body: undefined as any,
    socket: { remoteAddress: '203.0.113.10' } as any,
    headers: {
      'x-user-id': 'u1',
      'x-tenant-id': 'tenant-alpha',
      'x-user-roles': 'PROJECT_MANAGER',
      'x-resource-owner-id': 'u1',
    } as Record<string, unknown>,
  });
  const inputs = h.variants(
    base,
    {
      now: [at(15, 5, 59), at(15, 6), at(15, 21, 59), at(15, 22), at(17, 12), at(18, 12), at(19, 6), at(16, 23)],
      method: ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'get', 'post'],
      path: [
        '/documents/d1', '/documents/confidential/d2', '/documents/confidential/a/b', '/financial/ledger', '/tasks/t1', '/tickets/9',
        '/api/v1/tasks/t1', '/api/v2/financial/q3', 'tasks/t1', '/', '/unknown/x/y', '/PROJECTS/P1', '/projects/', '/projects.x/1',
      ],
      query: [{ ownerId: 'u1' }, { ownerId: 'u2', extra: '1' }, null],
      params: [{ id: 'p1' }, { id: 't1' }, null],
      body: [{ amount: 5 }, 'text', null],
      socket: [{}, { remoteAddress: '10.9.8.7' }],
      'headers.x-user-id': ['u2', h.DEL, ''],
      'headers.x-tenant-id': ['tenant-beta', '*', h.DEL, ''],
      'headers.x-user-roles': [
        'VIEWER', 'CONTRIBUTOR', 'TENANT_ADMIN', 'SECURITY_OFFICER', 'SYSTEM_ADMIN', 'AUDITOR', 'CROSS_TENANT_AUDITOR',
        'CONTRIBUTOR, AUDITOR', ' VIEWER ,PROJECT_MANAGER', 'UNKNOWN_ROLE', '', h.DEL, 'contributor',
      ],
      'headers.x-user-clearance': ['0', '2', '3', '4', 'abc', '-1', '3.9'],
      'headers.x-forwarded-for': ['10.1.2.3', '192.168.1.50', '192.168.2.50', '8.8.8.8, 10.0.0.1', '10.0.0.1 , 8.8.8.8', 'not-an-ip', '', '11.0.0.1'],
      'headers.x-geo-country': ['PT', 'us'],
      'headers.x-super-admin': ['true', 'false', 'TRUE'],
      'headers.x-emergency-bypass-token': ['CRITICAL_OVERRIDE_SECRET_99', 'wrong-token', ''],
      'headers.x-user-delegations': [
        JSON.stringify([{ delegatorId: 'boss', roles: ['TENANT_ADMIN'], expiresAt: future, scope: 'all' }]),
        JSON.stringify([{ delegatorId: 'boss', roles: ['SYSTEM_ADMIN'], expiresAt: future, scope: 'all' }]),
        JSON.stringify([{ delegatorId: 'boss', roles: ['TENANT_ADMIN'], expiresAt: h.NOW, scope: 'all' }]),
        JSON.stringify([{ delegatorId: 'boss', roles: ['SECURITY_OFFICER', 'CONTRIBUTOR'], expiresAt: future * 2, scope: 'x' }, { delegatorId: '', roles: ['SYSTEM_ADMIN'], expiresAt: future }]),
        JSON.stringify([{ delegatorId: 'boss', roles: 'TENANT_ADMIN', expiresAt: future }, { delegatorId: 'b', roles: ['VIEWER'], expiresAt: 'soon' }]),
        JSON.stringify({ delegatorId: 'boss' }),
        '[not json',
      ],
      'headers.x-user-attributes': [JSON.stringify({ department: 'finance' }), '{oops'],
      'headers.x-resource-id': ['r-77', ''],
      'headers.x-resource-type': ['documents', 'projects', 'Tasks'],
      'headers.x-resource-tenant-id': ['tenant-alpha', 'tenant-beta', '*'],
      'headers.x-resource-classification': ['0', '2', '3', '4', 'x'],
      'headers.x-resource-owner-id': ['u2', h.DEL, ''],
      'headers.x-resource-tags': ['a, b ,c', ''],
      'headers.x-action-override': ['manage', 'read', 'EXECUTE', 'delete', 'Audit', ''],
    },
    { random: 9000, maxK: 9, seed: 111 },
  );
  return inputs.map(({ label, input }) => ({
    label,
    run: (mod) => {
      const { now, ...request } = input;
      h.setNow(now);
      const { req, res, next, trace } = h.http(request);
      const returned = new mod.AccessControlPolicyMiddleware().use(req, res, next);
      return { returned, ...trace() };
    },
  }));
});
