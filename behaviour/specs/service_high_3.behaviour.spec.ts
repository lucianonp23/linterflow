import { defineSubject } from '../harness';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

defineSubject('service_high_3', (h) => {
  const tx = (ts: number, amount: number, extra: Record<string, unknown> = {}) => ({
    id: `tx-${ts}-${amount}`,
    timestamp: ts,
    amount,
    currency: 'USD',
    location: { latitude: 40.0, longitude: -74.0, countryCode: 'US' },
    deviceId: 'dev-1',
    ipAddress: '198.51.100.7',
    merchantCategoryCode: '5411',
    status: 'SUCCESS',
    ...extra,
  });

  const histories: Record<string, (t: number) => unknown[]> = {
    none: () => [],
    burst5mHigh: (t) => [tx(t - MIN, 400), tx(t - 2 * MIN, 400), tx(t - 3 * MIN, 400)],
    burst5mLow: (t) => [tx(t - MIN, 50), tx(t - 2 * MIN, 50), tx(t - 3 * MIN, 50)],
    burstExactly1000: (t) => [tx(t - MIN, 500), tx(t - 2 * MIN, 250), tx(t - 5 * MIN, 250)],
    hourly8: (t) => [10, 16, 22, 28, 34, 40, 46, 58].map((m) => tx(t - m * MIN, 20)),
    hourly7: (t) => [10, 16, 22, 28, 34, 40, 46].map((m) => tx(t - m * MIN, 20)),
    failed3: (t) => [2, 3, 4].map((hh) => tx(t - hh * HOUR, 30, { status: 'FAILED' })),
    failed6: (t) => [2, 3, 4, 5, 6, 7].map((hh, i) => tx(t - hh * HOUR, 30, { status: i % 2 ? 'FAILED' : 'REJECTED' })),
    failedOld: (t) => [25, 26, 27].map((hh) => tx(t - hh * HOUR, 30, { status: 'FAILED' })),
    micro: (t) => [tx(t - 6 * MIN, 1), tx(t - 8 * MIN, 2.5), tx(t - 10 * MIN, 5)],
    microTooFew: (t) => [tx(t - 6 * MIN, 1), tx(t - 8 * MIN, 5.01), tx(t - 10 * MIN, 5)],
    microThenOld: (t) => [tx(t - 6 * MIN, 1), tx(t - 20 * MIN, 2), tx(t - 21 * MIN, 3), tx(t - 22 * MIN, 4)],
    microUnsorted: (t) => [tx(t - 14 * MIN, 3), tx(t - 6 * MIN, 0), tx(t - 9 * MIN, 2), tx(t - 12 * MIN, 4)],
    farFast: (t) => [tx(t - HOUR, 60, { location: { latitude: 60.0, longitude: -74.0, countryCode: 'CA' } })],
    farMedium: (t) => [tx(t - HOUR, 60, { location: { latitude: 45.4, longitude: -74.0, countryCode: 'CA' } })],
    nearFast: (t) => [tx(t - MIN, 60, { location: { latitude: 41.0, longitude: -74.0, countryCode: 'US' } })],
    sameInstant: (t) => [tx(t, 60, { location: { latitude: 60.0, longitude: 10.0, countryCode: 'NO' } })],
    future: (t) => [tx(t + HOUR, 60, { location: { latitude: 60.0, longitude: 10.0, countryCode: 'NO' } })],
    old: (t) => [tx(t - 3 * DAY, 60)],
    mixed: (t) => [
      tx(t - MIN, 600),
      tx(t - 2 * MIN, 3),
      tx(t - 4 * MIN, 500, { status: 'FAILED' }),
      tx(t - 30 * MIN, 5, { status: 'REJECTED' }),
      tx(t - 3 * HOUR, 80, { status: 'FAILED', location: { latitude: -33.9, longitude: 151.2, countryCode: 'AU' } }),
      tx(t - 5 * HOUR, 80, { status: 'FAILED' }),
    ],
  };

  const base = () => ({
    timestamp: h.NOW,
    amount: 80,
    merchantCategoryCode: '5999',
    cardBin: '411111',
    cardCountry: 'US',
    country: 'US',
    latitude: 40.0,
    longitude: -74.0,
    history: 'none',
    blacklistedIps: [] as string[],
    blacklistedDevices: [] as string[],
    blacklistedCards: [] as string[],
    highRiskCountries: ['KP', 'IR'],
    disposableEmailDomains: ['mailinator.com', 'tempmail.io'],
    accountAgeMs: 400 * DAY,
    user: {
      email: 'ana@example.com',
      emailVerified: true,
      phoneVerified: true,
      mfaEnabled: true,
      homeCountry: 'US',
      avgTransactionAmount30Days: 100,
      transactionCount30Days: 20,
      chargebackHistoryCount: 0,
      failedLoginAttempts24h: 0,
    },
    device: {
      deviceId: 'dev-1',
      ipAddress: '198.51.100.7',
      connectionType: 'RESIDENTIAL',
      isKnownDevice: true,
      userAgent: 'UA',
      os: 'iOS',
      browser: 'Safari',
      language: 'en',
      isEmulated: false,
      hasRootOrJailbreak: false,
    },
  });

  const inputs = h.variants(
    base,
    {
      timestamp: [Date.UTC(2026, 0, 15, 2, 30), Date.UTC(2026, 0, 15, 1, 0), Date.UTC(2026, 0, 15, 4, 59), Date.UTC(2026, 0, 15, 5, 0), Date.UTC(2026, 0, 15, 0, 59)],
      amount: [0, 99, 100.01, 301, 500, 501, 1000, 1001, 2000, 2001, 6000, -50],
      merchantCategoryCode: ['6051', '6012', '7995', '5944', '5732', '4900', '5411', ''],
      cardBin: ['999999'],
      cardCountry: ['GB', 'KP'],
      country: ['GB', 'KP', 'IR', 'FR'],
      history: Object.keys(histories).filter((k) => k !== 'none'),
      blacklistedIps: [['198.51.100.7'], ['10.0.0.1']],
      blacklistedDevices: [['dev-1'], ['dev-x']],
      blacklistedCards: [['999999'], ['411111']],
      highRiskCountries: [[], ['US']],
      accountAgeMs: [0, 12 * HOUR, DAY, 3 * DAY, 7 * DAY, 20 * DAY, 30 * DAY, -DAY],
      'user.email': ['bot@MAILINATOR.com', 'x@tempmail.io', 'no-at-sign', '', 'a@b@mailinator.com'],
      'user.emailVerified': [false],
      'user.phoneVerified': [false],
      'user.mfaEnabled': [false],
      'user.homeCountry': ['GB', '', 'FR'],
      'user.avgTransactionAmount30Days': [0, -1, 7, 15, 25, 50, 300],
      'user.transactionCount30Days': [0, 10, 11],
      'user.chargebackHistoryCount': [1, 2, 5],
      'user.failedLoginAttempts24h': [4, 5, 9],
      'device.connectionType': ['TOR', 'PROXY', 'VPN', 'CELLULAR', 'UNKNOWN', 'SATELLITE'],
      'device.isKnownDevice': [false],
      'device.isEmulated': [true],
      'device.hasRootOrJailbreak': [true],
      'device.ipAddress': ['10.0.0.1'],
      'device.deviceId': ['dev-x'],
    },
    { random: 1500, maxK: 8, seed: 3 },
  );

  return inputs.map(({ label, input }) => ({
    label,
    run: (mod) => {
      const { history, accountAgeMs, country, latitude, longitude, user, ...rest } = input as any;
      const context = {
        ...rest,
        transactionId: 'txn-under-test',
        currency: 'USD',
        merchantId: 'm-1',
        location: { latitude, longitude, countryCode: country },
        user: { userId: 'u-1', accountCreatedTimestamp: rest.timestamp - accountAgeMs, ...user },
        history: histories[history](rest.timestamp),
      };
      return new mod.FraudDetectionEngineService().evaluateTransaction(context);
    },
  }));
});
