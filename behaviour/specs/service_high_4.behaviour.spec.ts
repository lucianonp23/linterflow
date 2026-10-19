import { defineSubject } from '../harness';

defineSubject('service_high_4', (h) => {
  const categories = ['cardiovascular', 'respiratory', 'neurological', 'gastrointestinal', 'trauma', 'obstetric', 'infectious', 'environmental', 'other'];
  const names = ['Chest pain', 'Productive cough', 'Headache', 'Watery diarrhea', 'Fall from ladder', 'Contractions', 'Fever and chills', 'Heat exposure', 'Rash'];
  const flagNames = [
    'isSuddenOnset', 'radiatesToJawOrArm', 'associatedWithDiaphoresis', 'associatedWithShortnessOfBreath', 'isThunderclapHeadache', 'hasFocalNeurologicalDeficit',
    'hasUnilateralWeakness', 'hasSlurredSpeech', 'hasFacialDroop', 'hasActiveBleeding', 'bleedingUncontrolled', 'isHeadTrauma', 'lossOfConsciousness', 'hasStridor',
    'hasWheezing', 'hasCalfPainOrSwelling', 'hasSevereAbdominalPain', 'hasVaginalBleeding', 'hasFluidLeakage', 'isAllergicReaction', 'hasAirwaySwelling', 'hasHives',
    'burnIncludesFaceHandGroin',
  ];
  const conditionFlags = ['isCOPD', 'isCHF', 'isCKD', 'isCAD', 'isDiabetes', 'isImmunocompromised', 'isActiveMalignancy'];
  const medicationFlags = ['isAnticoagulant', 'isAntiplatelet', 'isBetaBlocker', 'isImmunosuppressant', 'isInsulin'];

  const inputFor = (seed: number) => {
    const r = h.rng(seed);
    // `calm` cases keep vitals normal so the lower-acuity rules are reached.
    const abnormal = r.pick([0.05, 0.05, 0.25, 0.6]);
    const vital = <T,>(normal: T[], odd: T[]) => (r.chance(abnormal) ? r.pick(odd) : r.pick(normal));
    const vitals = {
      heartRate: vital([62, 75, 88, 90], [29, 30, 40, 41, 50, 51, 81, 89, 91, 109, 110, 111, 130, 131, 170, 171, 180, 181]),
      systolicBloodPressure: vital([112, 124, 135], [60, 69, 70, 84, 85, 89, 90, 91, 99, 100, 101, 110, 111, 139, 140, 159, 160, 219, 220, 240]),
      diastolicBloodPressure: vital([70, 82], [40, 119, 120, 130]),
      respiratoryRate: vital([12, 14, 18, 20], [5, 6, 7, 8, 9, 11, 21, 22, 24, 25, 44, 45]),
      oxygenSaturation: vital([96, 98, 99], [78, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 97]),
      temperatureCelsius: vital([36.4, 36.8, 37.2], [34.5, 35.0, 35.1, 35.5, 35.9, 36.0, 37.8, 38.0, 38.1, 38.3, 38.5, 38.9, 39.0, 39.1, 40.2]),
      glasgowComaScale: vital([15, 15, 15], [3, 8, 9, 13, 14]),
      bloodGlucoseMgDl: vital([undefined, 95, 140], [25, 29, 30, 59, 60, 300, 301, 480]),
      painScale: vital([0, 1, 2, 3], [4, 5, 6, 7, 8, 9, 10]),
      supplementalOxygen: r.chance(0.15),
    };
    const chronicConditions = [];
    const conditionCount = r.pick([0, 0, 1, 2, 3, 4]);
    for (let k = 0; k < conditionCount; k++) {
      const c: any = { code: `C${k}`, name: `Condition ${k}` };
      for (const f of conditionFlags) if (r.chance(0.2)) c[f] = true;
      chronicConditions.push(c);
    }
    const medications = [];
    const medCount = r.pick([0, 0, 1, 2]);
    for (let k = 0; k < medCount; k++) {
      const m: any = { name: `Drug ${k}` };
      for (const f of medicationFlags) if (r.chance(0.25)) m[f] = true;
      medications.push(m);
    }
    const ageYears = r.pick([0, 0, 0, 3, 12, 17, 18, 30, 45, 46, 50, 55, 56, 64, 65, 80]);
    const patient = {
      ageYears,
      ageDays: ageYears === 0 ? r.pick([undefined, 5, 28, 29, 200]) : r.pick([undefined, undefined, 20]),
      gender: r.pick(['MALE', 'FEMALE', 'OTHER']),
      isPregnant: r.chance(0.2),
      gestationWeeks: r.pick([undefined, 8, 11, 12, 20, 21, 34]),
      chronicConditions,
      medications,
      allergies: [],
    };
    const symptoms = [];
    const symptomCount = r.pick([0, 0, 1, 1, 1, 2, 3]);
    const flagDensity = r.pick([0, 0.08, 0.2, 0.45]);
    for (let k = 0; k < symptomCount; k++) {
      const idx = r.int(categories.length);
      const s: any = { id: `S${k}`, category: categories[idx], name: r.chance(0.8) ? names[idx] : r.pick(names), onsetHoursAgo: r.pick([0.5, 4.5, 4.6, 12, 24, 25, 72]), isSuddenOnset: false };
      for (const f of flagNames) if (r.chance(flagDensity)) s[f] = true;
      if (r.chance(0.2)) s.bodySurfaceAreaBurnPercentage = r.pick([0, 5, 14, 15, 39, 40, 60]);
      if (s.lossOfConsciousness) s.lossOfConsciousnessDurationMinutes = r.pick([undefined, 1, 4, 5, 20]);
      symptoms.push(s);
    }
    return { patient, vitals, symptoms };
  };

  const cases = [];
  for (let i = 0; i < 40000; i++) {
    const input = inputFor(23000 + i);
    cases.push({ label: `patient-${i}`, run: (mod: any) => new mod.MedicalTriageService().evaluateTriage(input.patient, input.vitals, input.symptoms) });
  }
  return cases;
});
