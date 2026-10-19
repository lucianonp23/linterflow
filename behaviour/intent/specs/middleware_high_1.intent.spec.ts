/**
 * middleware_high_1 — KYC/AML compliance middleware.
 * Prompt: "a KYC/AML compliance check (document types, risk countries, watchlists) ... Implement
 * every rule and edge case fully and explicitly".
 *
 * Divergence under study: the refactored loop marks a document as primary ID / proof of address
 * BEFORE checking its dates, so a document whose dates cannot be parsed now counts as valid.
 * The file's own message for this rule reads "No valid primary identity document ... provided".
 */
import { http } from '../../harness';
import { load, freezeClock, NOW } from '../load';

const mod = load('middleware_high_1');
freezeClock();

const DAY = 86400000;
const iso = (d: number) => new Date(NOW + d * DAY).toISOString();
// ICAO 9303 specimen passport, valid check digits.
const MRZ = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<' + 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

const passport = (o: Record<string, unknown> = {}) => ({
  type: 'PASSPORT', documentNumber: 'P-1', issuingCountry: 'PT', issueDate: iso(-400), expiryDate: iso(2000),
  mrzCode: MRZ, qualityScore: 95, faceMatchScore: 95, ...o,
});
const utilityBill = (o: Record<string, unknown> = {}) => ({
  type: 'UTILITY_BILL', documentNumber: 'U-1', issuingCountry: 'PT', issueDate: iso(-10), expiryDate: iso(2000),
  qualityScore: 95, extractedAddress: { street: 'Rua A', city: 'Porto', postalCode: '4000', country: 'PT' }, ...o,
});
const applicant = (documents: unknown[], o: Record<string, unknown> = {}) => ({
  applicantId: 'APP-1', firstName: 'Ana', lastName: 'Silva', dateOfBirth: '1990-06-01', nationality: 'PT', residenceCountry: 'PT',
  occupation: 'Software engineer', monthlyExpectedTurnoverUsd: 5000, declaredSourceOfFunds: 'Salary', documents, watchlistHits: [], ...o,
});
const evaluate = (body: unknown) => {
  const { req, res, next } = http({ method: 'POST', body });
  new mod.KycAmlComplianceMiddleware().use(req, res, next);
  return req.kycEvaluation;
};

describe('middleware_high_1', () => {
  test('[ANCHOR] (domain) a valid passport satisfies the primary-ID requirement', () => {
    const r = evaluate(applicant([passport()]));
    expect(r.requiredActions).not.toContain('SUBMIT_PRIMARY_GOVERNMENT_ID');
  });

  test('[ANCHOR] (domain) an applicant with no identity document is asked for one', () => {
    const r = evaluate(applicant([utilityBill()]));
    expect(r.requiredActions).toContain('SUBMIT_PRIMARY_GOVERNMENT_ID');
  });

  test('[TARGET] (contract: "No valid primary identity document") a passport with unparseable dates does not count as primary ID', () => {
    const r = evaluate(applicant([passport({ issueDate: 'bad-date', expiryDate: 'bad-date' })]));
    expect(r.requiredActions).toContain('SUBMIT_PRIMARY_GOVERNMENT_ID');
  });

  test('[TARGET] (domain) an applicant whose only ID has unparseable dates is not approved', () => {
    const r = evaluate(applicant([passport({ issueDate: 'bad-date', expiryDate: 'bad-date' })]));
    expect(r.status).not.toBe('APPROVED');
  });

  test('[TARGET] (domain) proof of address with an unparseable date does not satisfy the proof-of-address rule', () => {
    // Turnover above 15 000 makes proof of address mandatory (rule declared in the file).
    const r = evaluate(applicant([passport(), utilityBill({ issueDate: 'bad-date' })], { monthlyExpectedTurnoverUsd: 50000 }));
    expect(r.requiredActions).toContain('SUBMIT_PROOF_OF_ADDRESS');
  });
});
