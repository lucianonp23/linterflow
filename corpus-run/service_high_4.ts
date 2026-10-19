import { Injectable } from '@nestjs/common';

export enum TriageLevel {
  LEVEL_1_RESUSCITATION = 1,
  LEVEL_2_EMERGENT = 2,
  LEVEL_3_URGENT = 3,
  LEVEL_4_LESS_URGENT = 4,
  LEVEL_5_NON_URGENT = 5,
}

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export enum PainSeverity {
  NONE = 0,
  MILD = 1,
  MODERATE = 2,
  SEVERE = 3,
  UNBEARABLE = 4,
}

export interface VitalSigns {
  heartRate: number;
  systolicBloodPressure: number;
  diastolicBloodPressure: number;
  respiratoryRate: number;
  oxygenSaturation: number;
  temperatureCelsius: number;
  glasgowComaScale: number;
  bloodGlucoseMgDl?: number;
  painScale: number;
  supplementalOxygen: boolean;
}

export interface ChronicCondition {
  code: string;
  name: string;
  isCOPD?: boolean;
  isCHF?: boolean;
  isCKD?: boolean;
  isCAD?: boolean;
  isDiabetes?: boolean;
  isImmunocompromised?: boolean;
  isActiveMalignancy?: boolean;
}

export interface Medication {
  name: string;
  isAnticoagulant?: boolean;
  isAntiplatelet?: boolean;
  isBetaBlocker?: boolean;
  isImmunosuppressant?: boolean;
  isInsulin?: boolean;
}

export interface PatientProfile {
  ageYears: number;
  ageDays?: number;
  gender: Gender;
  isPregnant: boolean;
  gestationWeeks?: number;
  chronicConditions: ChronicCondition[];
  medications: Medication[];
  allergies: string[];
}

export interface Symptom {
  id: string;
  category: 'cardiovascular' | 'respiratory' | 'neurological' | 'gastrointestinal' | 'trauma' | 'obstetric' | 'infectious' | 'environmental' | 'other';
  name: string;
  onsetHoursAgo: number;
  isSuddenOnset: boolean;
  radiatesToJawOrArm?: boolean;
  associatedWithDiaphoresis?: boolean;
  associatedWithShortnessOfBreath?: boolean;
  isThunderclapHeadache?: boolean;
  hasFocalNeurologicalDeficit?: boolean;
  hasUnilateralWeakness?: boolean;
  hasSlurredSpeech?: boolean;
  hasFacialDroop?: boolean;
  hasActiveBleeding?: boolean;
  bleedingUncontrolled?: boolean;
  isHeadTrauma?: boolean;
  lossOfConsciousness?: boolean;
  lossOfConsciousnessDurationMinutes?: number;
  hasStridor?: boolean;
  hasWheezing?: boolean;
  hasCalfPainOrSwelling?: boolean;
  hasSevereAbdominalPain?: boolean;
  hasVaginalBleeding?: boolean;
  hasFluidLeakage?: boolean;
  isAllergicReaction?: boolean;
  hasAirwaySwelling?: boolean;
  hasHives?: boolean;
  bodySurfaceAreaBurnPercentage?: number;
  burnIncludesFaceHandGroin?: boolean;
}

export interface TriageAssessmentResult {
  triageLevel: TriageLevel;
  primaryReason: string;
  secondaryFactors: string[];
  news2Score: number;
  sirsCriteriaMet: number;
  isSepsisSuspected: boolean;
  isStrokePathwayTriggered: boolean;
  isSTEMIPathwayTriggered: boolean;
  isAnaphylaxisTriggered: boolean;
  recommendedInterventions: string[];
  evaluatedAt: Date;
}

interface ScoreRange {
  max: number;
  score: number;
}

@Injectable()
export class MedicalTriageService {

  public evaluateTriage(
    patient: PatientProfile,
    vitals: VitalSigns,
    symptoms: Symptom[]
  ): TriageAssessmentResult {
    const secondaryFactors: string[] = [];
    const recommendedInterventions: string[] = [];

    const isPediatric = patient.ageYears < 18;
    const isNeonate = (patient.ageDays !== undefined && patient.ageDays <= 28) || (patient.ageYears === 0 && patient.ageDays === undefined);
    const isInfant = patient.ageYears < 1;
    const isGeriatric = patient.ageYears >= 65;

    const news2Score = this.calculateNEWS2Score(vitals, patient);
    const sirsCriteriaMet = this.calculateSIRS(vitals, patient);

    const isStrokePathway = this.evaluateStrokePathway(patient, symptoms, secondaryFactors);
    const isSTEMIPathway = this.evaluateSTEMIPathway(patient, symptoms, vitals, secondaryFactors);
    const isAnaphylaxis = this.evaluateAnaphylaxisPathway(symptoms, secondaryFactors);

    let isSepsisSuspected = false;
    if (sirsCriteriaMet >= 2 && this.hasInfectiousSymptomOrRisk(symptoms, patient, vitals)) {
      isSepsisSuspected = true;
      secondaryFactors.push('Sepsis suspected based on SIRS criteria and clinical presentation');
    }

    const level1Reason = this.checkLevel1Resuscitation(patient, vitals, symptoms, isAnaphylaxis);
    if (level1Reason) {
      this.populateInterventionsForLevel1(recommendedInterventions, isSTEMIPathway, isStrokePathway, isAnaphylaxis);
      return {
        triageLevel: TriageLevel.LEVEL_1_RESUSCITATION,
        primaryReason: level1Reason,
        secondaryFactors,
        news2Score,
        sirsCriteriaMet,
        isSepsisSuspected,
        isStrokePathwayTriggered: isStrokePathway,
        isSTEMIPathwayTriggered: isSTEMIPathway,
        isAnaphylaxisTriggered: isAnaphylaxis,
        recommendedInterventions,
        evaluatedAt: new Date(),
      };
    }

    const level2Reason = this.checkLevel2Emergent(
      patient,
      vitals,
      symptoms,
      isSepsisSuspected,
      isStrokePathway,
      isSTEMIPathway,
      isAnaphylaxis,
      isNeonate,
      isInfant,
      isGeriatric,
      secondaryFactors
    );

    if (level2Reason) {
      this.populateInterventionsForLevel2(recommendedInterventions, isSepsisSuspected, isStrokePathway, isSTEMIPathway);
      return {
        triageLevel: TriageLevel.LEVEL_2_EMERGENT,
        primaryReason: level2Reason,
        secondaryFactors,
        news2Score,
        sirsCriteriaMet,
        isSepsisSuspected,
        isStrokePathwayTriggered: isStrokePathway,
        isSTEMIPathwayTriggered: isSTEMIPathway,
        isAnaphylaxisTriggered: isAnaphylaxis,
        recommendedInterventions,
        evaluatedAt: new Date(),
      };
    }

    const level3Reason = this.checkLevel3Urgent(
      patient,
      vitals,
      symptoms,
      news2Score,
      isGeriatric,
      isPediatric,
      secondaryFactors
    );

    if (level3Reason) {
      this.populateInterventionsForLevel3(recommendedInterventions);
      return {
        triageLevel: TriageLevel.LEVEL_3_URGENT,
        primaryReason: level3Reason,
        secondaryFactors,
        news2Score,
        sirsCriteriaMet,
        isSepsisSuspected,
        isStrokePathwayTriggered: isStrokePathway,
        isSTEMIPathwayTriggered: isSTEMIPathway,
        isAnaphylaxisTriggered: isAnaphylaxis,
        recommendedInterventions,
        evaluatedAt: new Date(),
      };
    }

    const level4Reason = this.checkLevel4LessUrgent(symptoms, vitals, secondaryFactors);
    if (level4Reason) {
      recommendedInterventions.push('Standard nursing assessment', 'Symptomatic control', 'Routine physician evaluation');
      return {
        triageLevel: TriageLevel.LEVEL_4_LESS_URGENT,
        primaryReason: level4Reason,
        secondaryFactors,
        news2Score,
        sirsCriteriaMet,
        isSepsisSuspected,
        isStrokePathwayTriggered: false,
        isSTEMIPathwayTriggered: false,
        isAnaphylaxisTriggered: false,
        recommendedInterventions,
        evaluatedAt: new Date(),
      };
    }

    recommendedInterventions.push('Fast-track clinic evaluation or primary care triage');
    return {
      triageLevel: TriageLevel.LEVEL_5_NON_URGENT,
      primaryReason: 'Non-urgent clinical presentation without physiological distress or high risk flags',
      secondaryFactors,
      news2Score,
      sirsCriteriaMet,
      isSepsisSuspected: false,
      isStrokePathwayTriggered: false,
      isSTEMIPathwayTriggered: false,
      isAnaphylaxisTriggered: false,
      recommendedInterventions,
      evaluatedAt: new Date(),
    };
  }

  private checkSymptomLevel1(symptom: Symptom, vitals: VitalSigns): string | null {
    if (symptom.category === 'respiratory' && symptom.hasStridor && vitals.oxygenSaturation < 90) {
      return 'Severe upper airway obstruction with stridor and hypoxic distress';
    }
    if (symptom.bleedingUncontrolled && vitals.systolicBloodPressure < 90) {
      return 'Exsanguinating hemorrhage with cardiovascular collapse';
    }
    if (symptom.category === 'trauma' && symptom.bodySurfaceAreaBurnPercentage && symptom.bodySurfaceAreaBurnPercentage >= 40) {
      return 'Major thermal injury covering >= 40% BSA';
    }
    return null;
  }

  private checkLevel1Resuscitation(
    patient: PatientProfile,
    vitals: VitalSigns,
    symptoms: Symptom[],
    isAnaphylaxis: boolean
  ): string | null {
    const isCopd = patient.chronicConditions.some(c => c.isCOPD);
    const oxygenThreshold = isCopd ? 82 : 85;

    const rules: (() => string | null)[] = [
      () => vitals.glasgowComaScale <= 8 ? 'Severe neurological compromise (GCS <= 8) requiring immediate airway protection' : null,
      () => (vitals.respiratoryRate <= 6 || vitals.respiratoryRate >= 45) ? `Extreme respiratory rate dysfunction (${vitals.respiratoryRate}/min) indicating impending arrest` : null,
      () => vitals.oxygenSaturation < oxygenThreshold ? `Critical arterial hypoxia (SpO2 ${vitals.oxygenSaturation}%) below minimum safety threshold` : null,
      () => vitals.systolicBloodPressure < 70 ? `Profound hypotension (Systolic BP ${vitals.systolicBloodPressure} mmHg) indicative of severe shock` : null,
      () => (vitals.heartRate < 30 || vitals.heartRate > 180) ? `Extreme hemodynamically unstable heart rate (${vitals.heartRate} bpm)` : null,
      () => {
        for (const symptom of symptoms) {
          const res = this.checkSymptomLevel1(symptom, vitals);
          if (res) return res;
        }
        return null;
      },
      () => (isAnaphylaxis && (vitals.systolicBloodPressure < 85 || vitals.oxygenSaturation < 88)) ? 'Anaphylactic shock with severe respiratory or cardiovascular collapse' : null,
      () => (vitals.bloodGlucoseMgDl !== undefined && vitals.bloodGlucoseMgDl < 30) ? 'Profound symptomatic hypoglycemia (< 30 mg/dL) with risk of irreversible brain injury' : null,
    ];

    for (const rule of rules) {
      const result = rule();
      if (result) return result;
    }

    return null;
  }

  private evalAnticoagHeadTrauma(symptom: Symptom, isOnAnticoagulant: boolean): string | null {
    return (symptom.isHeadTrauma && isOnAnticoagulant)
      ? 'Head trauma in patient on oral anticoagulation/antiplatelet therapy (High Intracranial Bleed Risk)'
      : null;
  }

  private evalThunderclap(symptom: Symptom): string | null {
    return symptom.isThunderclapHeadache
      ? 'Sudden onset thunderclap headache (Suspected Subarachnoid Hemorrhage)'
      : null;
  }

  private isPreeclampsiaRisk(gestation: number, sbp: number, symptom: Symptom): boolean {
    if (gestation <= 20 || sbp < 140) return false;
    return Boolean(symptom.hasSevereAbdominalPain || symptom.isThunderclapHeadache || sbp >= 160);
  }

  private isEctopicPregnancyRisk(gestation: number, symptom: Symptom): boolean {
    return gestation < 12 && Boolean(symptom.hasSevereAbdominalPain) && Boolean(symptom.hasVaginalBleeding);
  }

  private evalObstetric(symptom: Symptom, patient: PatientProfile, vitals: VitalSigns): string | null {
    if (symptom.category !== 'obstetric' || !patient.isPregnant) return null;
    const gestation = patient.gestationWeeks || 0;

    if (this.isPreeclampsiaRisk(gestation, vitals.systolicBloodPressure, symptom)) {
      return 'Severe preeclampsia / impending eclampsia risk criteria met';
    }
    if (this.isEctopicPregnancyRisk(gestation, symptom)) {
      return 'Ruptured ectopic pregnancy risk in early gestation with severe pain and bleeding';
    }
    return null;
  }

  private evalTraumaBurn(symptom: Symptom): string | null {
    if (symptom.category !== 'trauma') return null;
    if (symptom.bodySurfaceAreaBurnPercentage && symptom.bodySurfaceAreaBurnPercentage >= 15) {
      return `Moderate to major burn injury (${symptom.bodySurfaceAreaBurnPercentage}% BSA)`;
    }
    if (symptom.burnIncludesFaceHandGroin) {
      return 'Critical burn location involving face, hands, feet, or perineum';
    }
    return null;
  }

  private evalGiBleed(symptom: Symptom, vitals: VitalSigns): string | null {
    return (symptom.category === 'gastrointestinal' && symptom.hasActiveBleeding && vitals.heartRate > 110)
      ? 'Active gastrointestinal hemorrhage with hemodynamic compensation'
      : null;
  }

  private checkSymptomsLevel2(symptoms: Symptom[], patient: PatientProfile, vitals: VitalSigns): string | null {
    const isOnAnticoagulant = patient.medications.some(m => m.isAnticoagulant || m.isAntiplatelet);
    for (const symptom of symptoms) {
      const res = this.evalAnticoagHeadTrauma(symptom, isOnAnticoagulant)
        || this.evalThunderclap(symptom)
        || this.evalObstetric(symptom, patient, vitals)
        || this.evalTraumaBurn(symptom)
        || this.evalGiBleed(symptom, vitals);
      if (res) return res;
    }
    return null;
  }

  private checkPediatricLevel2(vitals: VitalSigns, isNeonate: boolean, isInfant: boolean): string | null {
    if (isNeonate) {
      if (vitals.temperatureCelsius >= 38.0 || vitals.temperatureCelsius < 36.0) {
        return `Neonatal fever/hypothermia (${vitals.temperatureCelsius}°C) requiring sepsis rule-out`;
      }
      if (vitals.heartRate > 170 || vitals.heartRate < 90) {
        return `Neonatal hemodynamically abnormal heart rate (${vitals.heartRate} bpm)`;
      }
    } else if (isInfant) {
      if (vitals.temperatureCelsius >= 38.5 && vitals.oxygenSaturation < 94) {
        return 'Infantile fever with associated hypoxia';
      }
    }
    return null;
  }

  private checkHypertensionLevel2(vitals: VitalSigns, symptoms: Symptom[], secondaryFactors: string[]): string | null {
    if (vitals.systolicBloodPressure >= 220 || vitals.diastolicBloodPressure >= 120) {
      const hasOrganSigns = symptoms.some(s => s.category === 'neurological' || s.category === 'cardiovascular' || s.isThunderclapHeadache);
      if (hasOrganSigns) {
        return 'Hypertensive emergency with acute end-organ dysfunction signs';
      }
      secondaryFactors.push('Asymptomatic or minimally symptomatic severe hypertension');
    }
    return null;
  }

  private checkImmunocompromisedLevel2(patient: PatientProfile, vitals: VitalSigns): string | null {
    const isImmunocompromised = patient.chronicConditions.some(c => c.isImmunocompromised || c.isActiveMalignancy) ||
      patient.medications.some(m => m.isImmunosuppressant);
    if (isImmunocompromised && vitals.temperatureCelsius >= 38.3) {
      return 'Neutropenic fever / febrile immunocompromised host requiring immediate parenteral antibiotics';
    }
    return null;
  }

  private checkHighRiskPainLevel2(vitals: VitalSigns, symptoms: Symptom[]): string | null {
    if (vitals.painScale >= 8) {
      const isHighRiskDomain = symptoms.some(s => s.category === 'cardiovascular' || s.category === 'gastrointestinal' || s.category === 'obstetric');
      if (isHighRiskDomain) {
        return `Severe acute unmanaged pain (${vitals.painScale}/10) in high-risk anatomical domain`;
      }
    }
    return null;
  }

  private checkLevel2Emergent(
    patient: PatientProfile,
    vitals: VitalSigns,
    symptoms: Symptom[],
    isSepsisSuspected: boolean,
    isStrokePathway: boolean,
    isSTEMIPathway: boolean,
    isAnaphylaxis: boolean,
    isNeonate: boolean,
    isInfant: boolean,
    isGeriatric: boolean,
    secondaryFactors: string[]
  ): string | null {
    const rules: (() => string | null)[] = [
      () => (vitals.glasgowComaScale >= 9 && vitals.glasgowComaScale <= 13) ? `Altered mental status / acute lethargy (GCS ${vitals.glasgowComaScale})` : null,
      () => this.checkPediatricLevel2(vitals, isNeonate, isInfant),
      () => isSTEMIPathway ? 'High-risk acute coronary syndrome (ACS) / suspected STEMI' : null,
      () => isStrokePathway ? 'Acute neurological deficit within hyperacute stroke intervention window' : null,
      () => isAnaphylaxis ? 'Acute anaphylactic reaction involving systemic multi-organ manifestations' : null,
      () => this.checkHypertensionLevel2(vitals, symptoms, secondaryFactors),
      () => (isSepsisSuspected && (vitals.systolicBloodPressure < 90 || vitals.glasgowComaScale < 15 || vitals.respiratoryRate >= 22))
        ? 'Severe sepsis / high risk for septic shock development'
        : null,
      () => this.checkImmunocompromisedLevel2(patient, vitals),
      () => this.checkSymptomsLevel2(symptoms, patient, vitals),
      () => (vitals.oxygenSaturation < 90 && !patient.chronicConditions.some(c => c.isCOPD)) ? `Severe arterial hypoxia (SpO2 ${vitals.oxygenSaturation}%)` : null,
      () => this.checkHighRiskPainLevel2(vitals, symptoms),
      () => (isGeriatric && vitals.temperatureCelsius < 35.0) ? `Geriatric profound hypothermia (${vitals.temperatureCelsius}°C)` : null,
    ];

    for (const rule of rules) {
      const result = rule();
      if (result) return result;
    }

    return null;
  }

  private checkGiLevel3(symptom: Symptom): string | null {
    return symptom.category === 'gastrointestinal' && symptom.hasSevereAbdominalPain
      ? 'Acute moderate-to-severe abdominal pain requiring diagnostic rule-out of acute abdomen'
      : null;
  }

  private checkRespiratoryLevel3(symptom: Symptom): string | null {
    const isRespiratoryDistress = symptom.category === 'respiratory' && (Boolean(symptom.hasWheezing) || Boolean(symptom.associatedWithShortnessOfBreath));
    return isRespiratoryDistress ? 'Moderate respiratory distress / bronchospasm presentation' : null;
  }

  private checkDvtLevel3(symptom: Symptom): string | null {
    return symptom.hasCalfPainOrSwelling && symptom.associatedWithShortnessOfBreath
      ? 'Suspected deep vein thrombosis with potential pulmonary embolism threat'
      : null;
  }

  private checkTraumaLevel3(symptom: Symptom): string | null {
    if (symptom.category !== 'trauma' || !symptom.lossOfConsciousness) return null;
    const duration = symptom.lossOfConsciousnessDurationMinutes || 0;
    return duration < 5 ? 'Head injury with transient loss of consciousness (< 5 mins)' : null;
  }

  private checkObstetricLevel3(symptom: Symptom, patient: PatientProfile): string | null {
    if (symptom.category !== 'obstetric' || !patient.isPregnant) return null;
    const hasBleedingOrLeak = Boolean(symptom.hasVaginalBleeding || symptom.hasFluidLeakage);
    return hasBleedingOrLeak ? 'Obstetric evaluation required for vaginal bleeding or fluid leakage' : null;
  }

  private checkSymptomLevel3(symptom: Symptom, patient: PatientProfile): string | null {
    return this.checkGiLevel3(symptom)
      || this.checkRespiratoryLevel3(symptom)
      || this.checkDvtLevel3(symptom)
      || this.checkTraumaLevel3(symptom)
      || this.checkObstetricLevel3(symptom, patient);
  }

  private checkBorderlineHypotensionLevel3(vitals: VitalSigns, patient: PatientProfile, isPediatric: boolean, secondaryFactors: string[]): string | null {
    if (vitals.systolicBloodPressure < 100 && !isPediatric) {
      if (patient.medications.some(m => m.isBetaBlocker)) {
        secondaryFactors.push('Borderline hypotension blunted by concurrent beta-blocker therapy');
      }
      return `Borderline hypotension (Systolic BP ${vitals.systolicBloodPressure} mmHg)`;
    }
    return null;
  }

  private checkGeriatricLevel3(patient: PatientProfile, vitals: VitalSigns, isGeriatric: boolean): string | null {
    if (!isGeriatric) return null;
    const riskFactorCount = (patient.chronicConditions.length >= 3 ? 1 : 0) +
      (vitals.respiratoryRate > 20 ? 1 : 0) +
      (vitals.heartRate > 90 ? 1 : 0);
    return riskFactorCount >= 2 ? 'Geriatric patient with multiple subtle physiological abnormalities and comorbidities' : null;
  }

  private checkLevel3Urgent(
    patient: PatientProfile,
    vitals: VitalSigns,
    symptoms: Symptom[],
    news2Score: number,
    isGeriatric: boolean,
    isPediatric: boolean,
    secondaryFactors: string[]
  ): string | null {
    const rules: (() => string | null)[] = [
      () => news2Score >= 5 ? `Elevated NEWS2 Aggregate Risk Score (${news2Score}) requiring urgent medical evaluation` : null,
      () => vitals.temperatureCelsius >= 39.0 ? `High fever (${vitals.temperatureCelsius}°C) exceeding standard pyrexia thresholds` : null,
      () => (vitals.bloodGlucoseMgDl !== undefined && (vitals.bloodGlucoseMgDl > 300 || vitals.bloodGlucoseMgDl < 60))
        ? `Significant glycemic dysregulation (${vitals.bloodGlucoseMgDl} mg/dL)`
        : null,
      () => vitals.painScale >= 7 ? `Severe acute physical pain rating (${vitals.painScale}/10)` : null,
      () => this.checkBorderlineHypotensionLevel3(vitals, patient, isPediatric, secondaryFactors),
      () => (vitals.heartRate >= 110 || vitals.heartRate <= 50) ? `Moderate heart rate abnormality (${vitals.heartRate} bpm)` : null,
      () => {
        for (const symptom of symptoms) {
          const res = this.checkSymptomLevel3(symptom, patient);
          if (res) return res;
        }
        return null;
      },
      () => this.checkGeriatricLevel3(patient, vitals, isGeriatric),
    ];

    for (const rule of rules) {
      const res = rule();
      if (res) return res;
    }

    return null;
  }

  private checkSymptomLevel4(symptom: Symptom): string | null {
    if (symptom.category === 'trauma') {
      return 'Uncomplicated minor extremity injury, sprain, or simple laceration';
    }
    if (symptom.category === 'gastrointestinal' && !symptom.hasSevereAbdominalPain && !symptom.hasActiveBleeding) {
      return 'Mild gastrointestinal upset, emesis, or uncomplicated diarrhea';
    }
    if (symptom.category === 'respiratory' && !symptom.associatedWithShortnessOfBreath) {
      return 'Upper respiratory tract infection symptoms without dyspnea';
    }
    return null;
  }

  private checkLevel4LessUrgent(
    symptoms: Symptom[],
    vitals: VitalSigns,
    secondaryFactors: string[]
  ): string | null {
    if (vitals.painScale >= 4 && vitals.painScale <= 6) {
      return `Moderate localized discomfort or pain (${vitals.painScale}/10)`;
    }

    if (vitals.temperatureCelsius >= 37.8 && vitals.temperatureCelsius < 39.0) {
      return `Mild-to-moderate pyrexia (${vitals.temperatureCelsius}°C) without hemodynamic compromise`;
    }

    for (const symptom of symptoms) {
      const res = this.checkSymptomLevel4(symptom);
      if (res) return res;
    }

    if (symptoms.length > 0) {
      return 'Simple single-system mild symptom presentation';
    }

    return null;
  }

  private scoreByRange(val: number, ranges: ScoreRange[]): number {
    for (const r of ranges) {
      if (val <= r.max) return r.score;
    }
    return 0;
  }

  private calculateCopdSatScore(sat: number, suppO2: boolean): number {
    if (sat <= 92) {
      return this.scoreByRange(sat, [
        { max: 83, score: 3 },
        { max: 85, score: 2 },
        { max: 87, score: 1 },
        { max: 92, score: 0 },
      ]);
    }
    if (!suppO2) return 0;
    return this.scoreByRange(sat, [
      { max: 94, score: 1 },
      { max: 96, score: 2 },
      { max: Infinity, score: 3 },
    ]);
  }

  private calculateNEWS2Score(vitals: VitalSigns, patient: PatientProfile): number {
    const rrScore = this.scoreByRange(vitals.respiratoryRate, [
      { max: 8, score: 3 },
      { max: 11, score: 1 },
      { max: 20, score: 0 },
      { max: 24, score: 2 },
      { max: Infinity, score: 3 },
    ]);

    const isCopd = patient.chronicConditions.some(c => c.isCOPD);
    const satScore = isCopd
      ? this.calculateCopdSatScore(vitals.oxygenSaturation, vitals.supplementalOxygen)
      : this.scoreByRange(vitals.oxygenSaturation, [
          { max: 91, score: 3 },
          { max: 93, score: 2 },
          { max: 95, score: 1 },
          { max: Infinity, score: 0 },
        ]);

    const suppO2Score = vitals.supplementalOxygen ? 2 : 0;

    const sbpScore = this.scoreByRange(vitals.systolicBloodPressure, [
      { max: 90, score: 3 },
      { max: 100, score: 2 },
      { max: 110, score: 1 },
      { max: 219, score: 0 },
      { max: Infinity, score: 3 },
    ]);

    const hrScore = this.scoreByRange(vitals.heartRate, [
      { max: 40, score: 3 },
      { max: 50, score: 1 },
      { max: 90, score: 0 },
      { max: 110, score: 1 },
      { max: 130, score: 2 },
      { max: Infinity, score: 3 },
    ]);

    const gcsScore = vitals.glasgowComaScale < 15 ? 3 : 0;

    const tempScore = this.scoreByRange(vitals.temperatureCelsius, [
      { max: 35.0, score: 3 },
      { max: 36.0, score: 1 },
      { max: 38.0, score: 0 },
      { max: 39.0, score: 1 },
      { max: Infinity, score: 2 },
    ]);

    return rrScore + satScore + suppO2Score + sbpScore + hrScore + gcsScore + tempScore;
  }

  private calculateSIRS(vitals: VitalSigns, patient: PatientProfile): number {
    let sirs = 0;

    if (vitals.temperatureCelsius > 38.0 || vitals.temperatureCelsius < 36.0) {
      sirs++;
    }

    const isOnBetaBlocker = patient.medications.some(m => m.isBetaBlocker);
    if (vitals.heartRate > 90 || (isOnBetaBlocker && vitals.heartRate > 80)) {
      sirs++;
    }

    if (vitals.respiratoryRate > 20) {
      sirs++;
    }

    return sirs;
  }

  private hasInfectiousSymptomOrRisk(symptoms: Symptom[], patient: PatientProfile, vitals: VitalSigns): boolean {
    if (vitals.temperatureCelsius >= 38.0 || vitals.temperatureCelsius <= 35.5) {
      return true;
    }

    for (const symptom of symptoms) {
      if (
        symptom.category === 'infectious' ||
        (symptom.category === 'respiratory' && symptom.name.toLowerCase().includes('cough')) ||
        (symptom.category === 'gastrointestinal' && symptom.name.toLowerCase().includes('diarrhea'))
      ) {
        return true;
      }
    }

    return false;
  }

  private evaluateStrokePathway(
    patient: PatientProfile,
    symptoms: Symptom[],
    secondaryFactors: string[]
  ): boolean {
    for (const symptom of symptoms) {
      if (symptom.category === 'neurological') {
        const isFASTPositive =
          symptom.hasFacialDroop ||
          symptom.hasUnilateralWeakness ||
          symptom.hasSlurredSpeech ||
          symptom.hasFocalNeurologicalDeficit;

        if (isFASTPositive) {
          if (symptom.onsetHoursAgo <= 24) {
            if (symptom.onsetHoursAgo <= 4.5) {
              secondaryFactors.push('Stroke alert: Within intravenous thrombolysis window (< 4.5 hours)');
            } else if (symptom.onsetHoursAgo <= 24) {
              secondaryFactors.push('Stroke alert: Within mechanical thrombectomy window (4.5 - 24 hours)');
            }
            return true;
          } else {
            secondaryFactors.push('Neurological deficit present but onset > 24 hours ago');
          }
        }
      }
    }
    return false;
  }

  private calculateACSScore(patient: PatientProfile, symptom: Symptom): number {
    const points = [
      symptom.isSuddenOnset ? 2 : 0,
      symptom.radiatesToJawOrArm ? 3 : 0,
      symptom.associatedWithDiaphoresis ? 2 : 0,
      symptom.associatedWithShortnessOfBreath ? 1 : 0,
      (patient.ageYears > 45 && patient.gender === Gender.MALE) ? 1 : 0,
      (patient.ageYears > 55 && patient.gender === Gender.FEMALE) ? 1 : 0,
      patient.chronicConditions.some(c => c.isCAD || c.isDiabetes) ? 2 : 0,
    ];
    return points.reduce((a, b) => a + b, 0);
  }

  private evaluateSTEMIPathway(
    patient: PatientProfile,
    symptoms: Symptom[],
    vitals: VitalSigns,
    secondaryFactors: string[]
  ): boolean {
    for (const symptom of symptoms) {
      if (symptom.category === 'cardiovascular') {
        const acuteChestPainScore = this.calculateACSScore(patient, symptom);
        if (acuteChestPainScore >= 5) {
          secondaryFactors.push(`High risk ACS presentation score (${acuteChestPainScore} points)`);
          return true;
        }
      }
    }
    return false;
  }

  private assessSymptomAnaphylaxis(symptom: Symptom): { systemCount: number; isAirwayOrSkin: boolean } {
    if (!symptom.isAllergicReaction) {
      return { systemCount: 0, isAirwayOrSkin: false };
    }

    const isAirway = Boolean(symptom.hasAirwaySwelling || symptom.hasStridor || symptom.hasWheezing);
    const isSkin = Boolean(symptom.hasHives);
    const isGI = symptom.category === 'gastrointestinal' && Boolean(symptom.hasSevereAbdominalPain);
    const isCardio = symptom.category === 'cardiovascular';

    const systemCount = (isAirway ? 1 : 0) + (isSkin ? 1 : 0) + (isGI ? 1 : 0) + (isCardio ? 1 : 0);
    const isAirwayOrSkin = isAirway || isSkin;

    return { systemCount, isAirwayOrSkin };
  }

  private evaluateAnaphylaxisPathway(symptoms: Symptom[], secondaryFactors: string[]): boolean {
    let affectedSystems = 0;
    let hasAirwaySkin = false;

    for (const symptom of symptoms) {
      const { systemCount, isAirwayOrSkin } = this.assessSymptomAnaphylaxis(symptom);
      affectedSystems += systemCount;
      if (isAirwayOrSkin) hasAirwaySkin = true;
    }

    if (affectedSystems >= 2 && hasAirwaySkin) {
      secondaryFactors.push(`Anaphylaxis protocol criteria met across ${affectedSystems} organ systems`);
      return true;
    }

    return false;
  }

  private populateInterventionsForLevel1(
    interventions: string[],
    isSTEMI: boolean,
    isStroke: boolean,
    isAnaphylaxis: boolean
  ): void {
    interventions.push(
      'Immediate Resuscitation Room allocation',
      'Continuous cardiac, pulse oximetry, and non-invasive BP monitoring',
      'Establish immediate Dual Large-Bore Peripheral IV access (16G/14G)',
      'High-flow supplementary Oxygen therapy / Prepare for Rapid Sequence Intubation (RSI)'
    );

    if (isSTEMI) {
      interventions.push('Immediate 12-lead ECG within 10 minutes', 'Activate Cardiac Catheterization Laboratory');
    }
    if (isStroke) {
      interventions.push('Code Stroke activation', 'Immediate unenhanced Head CT scan request');
    }
    if (isAnaphylaxis) {
      interventions.push('Intramuscular Epinephrine (1:1000) 0.3-0.5mg immediately', 'IV Fluid Bolus 20mL/kg');
    }
  }

  private populateInterventionsForLevel2(
    interventions: string[],
    isSepsis: boolean,
    isStroke: boolean,
    isSTEMI: boolean
  ): void {
    interventions.push(
      'Priority bed placement within 10 minutes',
      'Continuous vital sign monitoring',
      'Intravenous catheter placement and baseline laboratory draw'
    );

    if (isSepsis) {
      interventions.push(
        'Sepsis Six Bundle initiation',
        'Draw blood cultures prior to broad-spectrum antibiotic administration',
        'Measure serum lactate level',
        'Administer 30mL/kg crystalloid bolus for hypotension/lactate >= 4'
      );
    }
    if (isStroke) {
      interventions.push('Acute Stroke Team consultation', 'Stat Neuroimaging', 'Point-of-care glucose check');
    }
    if (isSTEMI) {
      interventions.push('Stat 12-lead ECG execution', 'Aspirin 300mg chewable administration if not contraindicated');
    }
  }

  private populateInterventionsForLevel3(interventions: string[]): void {
    interventions.push(
      'Placement in urgent treatment area',
      'Target physician evaluation within 30-60 minutes',
      'Targeted laboratory and diagnostic imaging investigations',
      'Re-assess vital signs every 30 minutes'
    );
  }
}