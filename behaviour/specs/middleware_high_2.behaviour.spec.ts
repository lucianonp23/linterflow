import { defineSubject } from '../harness';

defineSubject('middleware_high_2', (h) => {
  const DUE = Date.UTC(2026, 0, 10, 12);
  const HOURS = 3600000;
  const marks = [0, 12, 20, 29, 30, 31, 35, 39, 39.99, 40, 41, 45, 49, 50, 51, 55, 59, 60, 61, 65, 69.5, 70, 85, 100];
  const weightSets = [[1], [1], [1], [0.5, 0.5], [0.5, 0.5], [0.3, 0.3, 0.4], [0.3, 0.3, 0.4], [0.6, 0.4], [0.2, 0.8], [0.25, 0.25, 0.5], [0.1, 0.9], [0.5, 0.4], [0.7, 0.7]];

  const payloadFor = (seed: number) => {
    const r = h.rng(seed);
    const componentIds: string[] = [];
    const modules: any[] = [];
    const moduleCount = 1 + r.int(5);
    for (let m = 0; m < moduleCount; m++) {
      const weights = r.pick(weightSets);
      const components = weights.map((weight, c) => {
        const id = `M${m}-C${c}`;
        componentIds.push(id);
        const attempts: any[] = [];
        const attemptCount = r.chance(0.01) ? 0 : 1 + r.int(3);
        for (let a = 0; a < attemptCount; a++) {
          attempts.push({
            attemptNumber: r.chance(0.1) ? 1 : a + 1,
            rawMark: r.pick(marks),
            maxMark: r.pick([100, 100, 100, 100, 100, 100, 50, 0]),
            dueDate: r.chance(0.05) ? '' : new Date(DUE).toISOString(),
            submissionDate: r.chance(0.05) ? '' : new Date(DUE + r.pick([-48, -1, 0, 0, 0, 1, 23, 24, 25, 72, 200, 600]) * HOURS).toISOString(),
            isResit: r.chance(0.3),
            plagiarismPenaltyPercentage: r.pick([undefined, undefined, 0, 10, 100]),
            wordCountPenaltyPercentage: r.pick([undefined, undefined, 0, 5]),
          });
        }
        return {
          id,
          name: `Component ${c}`,
          weight,
          isMandatoryPass: r.chance(0.3),
          mandatoryPassThreshold: r.pick([undefined, undefined, 35, 60]),
          attempts: r.chance(0.005) ? undefined : attempts,
        };
      });
      modules.push({
        code: r.chance(0.01) ? '' : `MOD${m}`,
        title: `Module ${m}`,
        credits: r.pick([15, 15, 20, 30, 30, 45, 60, 0]),
        level: r.pick([4, 5, 6, 7, 7, 8, 9]),
        isCore: r.chance(0.25),
        isNonCompensable: r.chance(0.15),
        requiresProfessionalAccreditation: r.chance(0.15),
        components: r.chance(0.005) ? 'not-an-array' : components,
      });
    }
    const ecs: any[] = [];
    const ecCount = r.int(4);
    for (let e = 0; e < ecCount; e++) {
      const affected = new Set<string>();
      const n = 1 + r.int(3);
      for (let k = 0; k < n; k++) affected.add(r.chance(0.1) ? 'unknown-component' : r.pick(componentIds));
      ecs.push({
        id: `EC${e}`,
        code: r.pick(['MEDICAL', 'BEREAVEMENT', 'TECHNICAL', 'ACADEMIC_CONCESSION', 'DISREGARD', 'DISREGARD', 'UNCAPPED_RESIT']),
        approved: r.chance(0.8),
        affectedComponentIds: [...affected],
        extensionDays: r.pick([undefined, 0, 1, 2, 7]),
      });
    }
    return {
      method: r.pick(['POST', 'POST', 'POST', 'POST', 'PUT', 'PATCH', 'GET', 'HEAD', 'OPTIONS']),
      body: {
        studentId: r.chance(0.03) ? '' : 'S-1001',
        programCode: 'MEEC',
        academicYear: '2025/26',
        stage: r.pick([1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 6, 0, 7, '2']),
        cumulativeCompensatedCredits: r.pick([0, 0, 15, 30]),
        cumulativeResitCredits: r.pick([0, 20]),
        extenuatingCircumstances: ecs,
        modules: r.chance(0.02) ? [] : r.chance(0.02) ? 'not-an-array' : modules,
      } as unknown,
    };
  };

  const cases = [];
  for (let i = 0; i < 4000; i++) cases.push({ label: `payload-${i}`, input: payloadFor(8000 + i) });
  [null, undefined, 'text', 42, {}, { studentId: 'S-1' }].forEach((body, i) => cases.push({ label: `malformed-${i}`, input: { method: 'POST', body } }));

  return cases.map(({ label, input }) => ({
    label,
    run: (mod) => {
      const { req, res, next, trace } = h.http({ method: input.method, headers: {}, body: input.body });
      const returned = new mod.StudentGradingAndProgressionMiddleware().use(req, res, next);
      return { returned, ...trace() };
    },
  }));
});
