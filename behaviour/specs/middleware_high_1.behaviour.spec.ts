import { defineSubject } from '../harness';

const DAY = 86400000;

defineSubject('middleware_high_1', (h) => {
  const iso = (offsetDays: number) => new Date(h.NOW + offsetDays * DAY).toISOString();
  // ICAO 9303 specimen passport (valid check digits) and corrupted copies of it.
  const MRZ_L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
  const MRZ_L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
  const mrzCodes = [
    undefined,
    '',
    MRZ_L1 + MRZ_L2,
    `${MRZ_L1}\n${MRZ_L2.toLowerCase()}`,
    MRZ_L1 + MRZ_L2.replace('L898902C36', 'L898902C46'),
    MRZ_L1 + MRZ_L2.replace('7408122', '7408123'),
    MRZ_L1 + MRZ_L2.replace('1204159', '1204150'),
    MRZ_L1 + MRZ_L2.replace('L898902C3', 'L8989?2-3'),
    'X'.repeat(72),
    'X'.repeat(90),
    'TOO-SHORT',
  ];
  const countries = ['PT', 'PT', 'PT', 'US', 'SG', 'DE', 'IR', 'kp', 'KH', 'NG', 'RU', 'ua-crimea', 'MX', 'br'];
  const docTypes = ['PASSPORT', 'PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'RESIDENCE_PERMIT', 'UTILITY_BILL', 'TAX_DECLARATION', 'BANK_STATEMENT', 'LIBRARY_CARD'];
  const occupations = ['Software engineer', 'crypto trader', 'Casino host', 'real_estate agent', 'Politician', 'freelance designer', 'Retail clerk', 'STUDENT', 'unemployed', 'Student and crypto miner', ''];
  const funds = ['Salary', 'savings', 'Gift from uncle', 'unknown', 'ab', '   ', 'Lottery', 'company_profits', 'Cash_savings', ''];
  const dobs = ['1990-06-01', '1990-06-01', '2008-01-16', '2008-01-15', '2008-02-01', '2005-01-16', '2005-01-15', '2006-07-01', '1950-01-15', '1950-01-16', '1940-03-03', 'garbage', '2030-01-01', '2026-01-15'];
  const turnovers = [500, 5000, 10000, 10001, 15000, 15001, 50000, 50001, 100000, 100001];

  const payloadFor = (r: ReturnType<typeof h.rng>) => {
    const residence = r.pick(countries);
    const nationality = r.chance(0.6) ? residence : r.pick(countries);
    const documents: any[] = [];
    const docCount = r.chance(0.06) ? 0 : 1 + r.int(4);
    for (let d = 0; d < docCount; d++) {
      const type = r.pick(docTypes);
      documents.push({
        type,
        documentNumber: `DOC-${d}`,
        issuingCountry: r.chance(0.6) ? residence : r.pick(countries),
        issueDate: r.pick([iso(-10), iso(-89), iso(-90), iso(-91), iso(-400), iso(-2000), 'bad-date']),
        expiryDate: r.pick([iso(2000), iso(2000), iso(400), iso(31), iso(30), iso(29.5), iso(1), iso(0), iso(-1), 'bad-date']),
        mrzCode: r.pick(mrzCodes),
        qualityScore: r.pick([95, 95, 75, 74, 50, 49, 0]),
        faceMatchScore: r.pick([undefined, 95, 80, 79, 65, 64, 60, 59, 10]),
        extractedAddress: r.pick([undefined, { street: 'Rua A', city: 'Porto', postalCode: '4000', country: residence.toLowerCase() }, { street: 'X', city: 'Y', postalCode: '1', country: 'ZZ' }]),
      });
    }
    const watchlistHits: any[] = [];
    const hitCount = r.chance(0.6) ? 0 : 1 + r.int(3);
    for (let w = 0; w < hitCount; w++) {
      watchlistHits.push({
        id: `W${w}`,
        category: r.pick(['SANCTION', 'PEP', 'PEP', 'CRIMINAL', 'SIP', 'ADVERSE_MEDIA', 'OTHER']),
        fullName: `Person ${w}`,
        aliases: [],
        matchScore: r.pick([100, 85, 84, 80, 79, 70, 69, 65, 64, 50, 49, 10]),
        matchType: r.pick(['EXACT', 'PHONETIC', 'FUZZY']),
        pepTier: r.pick([undefined, 'TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'NONE']),
      });
    }
    return {
      applicantId: 'APP-1',
      firstName: 'Ana',
      lastName: 'Silva',
      dateOfBirth: r.pick(dobs),
      nationality,
      residenceCountry: residence,
      secondaryNationality: r.pick([undefined, undefined, undefined, 'FR', 'SY', 'PK', 'TR']),
      occupation: r.pick(occupations),
      monthlyExpectedTurnoverUsd: r.pick(turnovers),
      declaredSourceOfFunds: r.pick(funds),
      documents: r.chance(0.03) ? undefined : documents,
      watchlistHits: r.chance(0.1) ? undefined : watchlistHits,
    };
  };

  const cases: { label: string; input: { headers: Record<string, unknown>; body: unknown } }[] = [];
  for (let i = 0; i < 6000; i++) {
    const r = h.rng(10000 + i);
    const payload = payloadFor(r);
    const strict = r.chance(0.3) ? { 'x-enforce-strict-compliance': r.pick(['true', 'true', 'false', 'TRUE']) } : {};
    const viaHeader = r.chance(0.08);
    cases.push({
      label: `applicant-${i}`,
      input: viaHeader
        ? { headers: { ...strict, 'x-kyc-payload': JSON.stringify(payload) }, body: r.pick([undefined, {}, null]) }
        : { headers: strict, body: payload },
    });
  }

  const base = () => ({ headers: {} as Record<string, unknown>, body: payloadFor(h.rng(1)) as any });
  for (const { label, input } of h.variants(
    base,
    {
      body: [null, undefined, {}, 'text', []],
      'headers.x-kyc-payload': ['{broken json', 'null', '{}', '"just a string"', 12, JSON.stringify({ applicantId: 'A' })],
      'body.applicantId': ['', 7, h.DEL],
      'body.dateOfBirth': ['', 19900101, h.DEL],
      'body.nationality': ['', 5, h.DEL],
      'body.residenceCountry': ['', 5, h.DEL],
      'body.monthlyExpectedTurnoverUsd': ['5000', null, h.DEL],
      'body.occupation': [h.DEL, null],
      'body.declaredSourceOfFunds': [h.DEL, null],
    },
    { random: 300, maxK: 4, seed: 101 },
  )) {
    cases.push({ label: `validation/${label}`, input });
  }

  return cases.map(({ label, input }) => ({
    label,
    run: (mod) => {
      const { req, res, next, trace } = h.http({ method: 'POST', headers: input.headers, body: input.body });
      const returned = new mod.KycAmlComplianceMiddleware().use(req, res, next);
      return { returned, ...trace() };
    },
  }));
});
