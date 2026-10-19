/**
 * middleware_high_2 — student grading and progression middleware.
 * Prompt: "a student grading and progression engine (weighted components, resits, caps) ...
 * Implement every rule and edge case fully and explicitly".
 *
 * Divergence under study: with maxMark 0 the mark is 0/0 = NaN. In the original every
 * comparison with NaN is false and the module ends FAILED_NO_RESIT with 0 credits; in the
 * refactored version the compensation test lets it through and 15 credits are awarded.
 */
import { http } from '../../harness';
import { load, freezeClock, thrown } from '../load';

const mod = load('middleware_high_2');
freezeClock();

const student = (rawMark: number, maxMark: number) => ({
  studentId: 'S1', programCode: 'P1', academicYear: '2025/26', stage: 2,
  cumulativeCompensatedCredits: 0, cumulativeResitCredits: 0, extenuatingCircumstances: [],
  modules: [{
    code: 'M1', title: 'Module', credits: 15, level: 5, isCore: false, isNonCompensable: false, requiresProfessionalAccreditation: false,
    components: [{ id: 'C1', name: 'Exam', weight: 1, isMandatoryPass: false,
      attempts: [{ attemptNumber: 1, rawMark, maxMark, submissionDate: '2026-01-10T00:00:00.000Z', dueDate: '2026-01-10T00:00:00.000Z', isResit: false }] }],
  }],
});
const grade = (body: unknown) => {
  const { req, res, next } = http({ method: 'POST', body });
  new mod.StudentGradingAndProgressionMiddleware().use(req, res, next);
  return req.gradingContext.processedModules[0];
};

describe('middleware_high_2', () => {
  test('[ANCHOR] (domain) 60/100 on a level-5 module passes and awards the module credits', () => {
    const m = grade(student(60, 100));
    expect(m.status).toBe('PASSED');
    expect(m.creditsAwarded).toBe(15);
  });

  test('[ANCHOR] (domain) 10/100 on a level-5 module does not pass and awards no credits', () => {
    const m = grade(student(10, 100));
    expect(m.status).not.toMatch(/^PASSED/);
    expect(m.creditsAwarded).toBe(0);
  });

  test('[TARGET] (domain) an attempt with maxMark 0 (no valid mark) earns no credits and no pass', () => {
    const m = grade(student(0, 0));
    expect(m.creditsAwarded).toBe(0);
    expect(m.status).not.toMatch(/^PASSED/);
  });

  test('[IDEAL] (prompt: every edge case explicit) an attempt with maxMark 0 is rejected as invalid input', () => {
    const e = thrown(() => grade(student(0, 0)));
    expect(['BadRequestException', 'UnprocessableEntityException']).toContain(e?.constructor?.name);
  });
});
