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
    const isNeonate = this.checkIsNeonate(patient);
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
      return this.buildResult(
        TriageLevel.LEVEL_1_RESUSCITATION,
        level1Reason,
        secondaryFactors,
        news2Score,
        sirsCriteriaMet,
        isSepsisSuspected,
        isStrokePathway,
        isSTEMIPathway,
        isAnaphylaxis,
        recommendedInterventions
      );
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
      return this.buildResult(
        TriageLevel.LEVEL_2_EMERGENT,
        level2Reason,
        secondaryFactors,
        news2Score,
        sirsCriteriaMet,
        isSepsisSuspected,
        isStrokePathway,
        isSTEMIPathway,
        isAnaphylaxis,
        recommendedInterventions
      );
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
      return this.buildResult(
        TriageLevel.LEVEL_3_URGENT,
        level3Reason,
        secondaryFactors,
        news2Score,
        sirsCriteriaMet,
        isSepsisSuspected,
        isStrokePathway,
        isSTEMIPathway,
        isAnaphylaxis,
        recommendedInterventions
      );
    }

    const level4Reason = this.checkLevel4LessUrgent(symptoms, vitals, secondaryFactors);
    if (level4Reason) {
      recommendedInterventions.push('Standard nursing assessment', 'Symptomatic control', 'Routine physician evaluation');
      return this.buildResult(
        TriageLevel.LEVEL_4_LESS_URGENT,
        level4Reason,
        secondaryFactors,
        news2Score,
        sirsCriteriaMet,
        isSepsisSuspected,
        false,
        false,
        false,
        recommendedInterventions
      );
    }

    recommendedInterventions.push('Fast-track clinic evaluation or primary care triage');
    return this.buildResult(
      TriageLevel.LEVEL_5_NON_URGENT,
      'Non-urgent clinical presentation without physiological distress or high risk flags',
      secondaryFactors,
      news2Score,
      sirsCriteriaMet,
      false,
      false,
      false,
      false,
      recommendedInterventions
    );
  }

  private checkLevel1Resuscitation(
    patient: PatientProfile,
    vitals: VitalSigns,
    symptoms: Symptom[],
    isAnaphylaxis: boolean
  ): string | null {
    if (vitals.glasgowComaScale <= 8) {
      return 'Severe neurological compromise (GCS <= 8) requiring immediate airway protection';
    }

    if (vitals.respiratoryRate <= 6 || vitals.respiratoryRate >= 45) {
      return `Extreme respiratory rate dysfunction (${vitals.respiratoryRate}/min) indicating impending arrest`;
    }

    const isCopd = this.hasCondition(patient, c => c.isCOPD);
    const oxygenThreshold = isCopd ? 82 : 85;
    if (vitals.oxygenSaturation < oxygenThreshold) {
      return `Critical arterial hypoxia (SpO2 ${vitals.oxygenSaturation}%) below minimum safety threshold`;
    }

    if (vitals.systolicBloodPressure < 70) {
      return `Profound hypotension (Systolic BP ${vitals.systolicBloodPressure} mmHg) indicative of severe shock`;
    }

    if (vitals.heartRate < 30 || vitals.heartRate > 180) {
      return `Extreme hemodynamically unstable heart rate (${vitals.heartRate} bpm)`;
    }

    for (const symptom of symptoms) {
      if (symptom.category === 'respiratory' && symptom.hasStridor && vitals.oxygenSaturation < 90) {
        return 'Severe upper airway obstruction with stridor and hypoxic distress';
      }

      if (symptom.bleedingUncontrolled && vitals.systolicBloodPressure < 90) {
        return 'Exsanguinating hemorrhage with cardiovascular collapse';
      }

      if (symptom.category === 'trauma' && symptom.bodySurfaceAreaBurnPercentage && symptom.bodySurfaceAreaBurnPercentage >= 40) {
        return 'Major thermal injury covering >= 40% BSA';
      }
    }

    if (isAnaphylaxis && (vitals.systolicBloodPressure < 85 || vitals.oxygenSaturation < 88)) {
      return 'Anaphylactic shock with severe respiratory or cardiovascular collapse';
    }

    if (vitals.bloodGlucoseMgDl !== undefined && vitals.bloodGlucoseMgDl < 30) {
      return 'Profound symptomatic hypoglycemia (< 30 mg/dL) with risk of irreversible brain injury';
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
    if (vitals.glasgowComaScale >= 9 && vitals.glasgowComaScale <= 13) {
      return `Altered mental status / acute lethargy (GCS ${vitals.glasgowComaScale})`;
    }

    const pediatricReason = this.checkPediatricFeverAndVitals(vitals, isNeonate, isInfant);
    if (pediatricReason) return pediatricReason;

    if (isSTEMIPathway) {
      return 'High-risk acute coronary syndrome (ACS) / suspected STEMI';
    }

    if (isStrokePathway) {
      return 'Acute neurological deficit within hyperacute stroke intervention window';
    }

    if (isAnaphylaxis) {
      return 'Acute anaphylactic reaction involving systemic multi-organ manifestations';
    }

    if (vitals.systolicBloodPressure >= 220 || vitals.diastolicBloodPressure >= 120) {
      const hasEndOrganSigns = symptoms.some(
        s => s.category === 'neurological' || s.category === 'cardiovascular' || s.isThunderclapHeadache
      );
      if (hasEndOrganSigns) {
        return 'Hypertensive emergency with acute end-organ dysfunction signs';
      }
      secondaryFactors.push('Asymptomatic or minimally symptomatic severe hypertension');
    }

    if (isSepsisSuspected && (vitals.systolicBloodPressure < 90 || vitals.glasgowComaScale < 15 || vitals.respiratoryRate >= 22)) {
      return 'Severe sepsis / high risk for septic shock development';
    }

    const isImmunocompromised =
      this.hasCondition(patient, c => c.isImmunocompromised || c.isActiveMalignancy) ||
      this.hasMedication(patient, m => m.isImmunosuppressant);

    if (isImmunocompromised && vitals.temperatureCelsius >= 38.3) {
      return 'Neutropenic fever / febrile immunocompromised host requiring immediate parenteral antibiotics';
    }

    const symptomReason = this.checkLevel2SymptomFlags(patient, vitals, symptoms);
    if (symptomReason) return symptomReason;

    if (vitals.oxygenSaturation < 90 && !this.hasCondition(patient, c => c.isCOPD)) {
      return `Severe arterial hypoxia (SpO2 ${vitals.oxygenSaturation}%)`;
    }

    if (vitals.painScale >= 8) {
      const isHighRiskPainContext = symptoms.some(
        s => s.category === 'cardiovascular' || s.category === 'gastrointestinal' || s.category === 'obstetric'
      );
      if (isHighRiskPainContext) {
        return `Severe acute unmanaged pain (${vitals.painScale}/10) in high-risk anatomical domain`;
      }
    }

    if (isGeriatric && vitals.temperatureCelsius < 35.0) {
      return `Geriatric profound hypothermia (${vitals.temperatureCelsius}°C)`;
    }

    return null;
  }

  private checkPediatricFeverAndVitals(vitals: VitalSigns, isNeonate: boolean, isInfant: boolean): string | null {
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

  private checkLevel2SymptomFlags(patient: PatientProfile, vitals: VitalSigns, symptoms: Symptom[]): string | null {
    const isOnAnticoagulant = this.hasMedication(patient, m => m.isAnticoagulant || m.isAntiplatelet);

    for (const symptom of symptoms) {
      if (symptom.isHeadTrauma && isOnAnticoagulant) {
        return 'Head trauma in patient on oral anticoagulation/antiplatelet therapy (High Intracranial Bleed Risk)';
      }

      if (symptom.isThunderclapHeadache) {
        return 'Sudden onset thunderclap headache (Suspected Subarachnoid Hemorrhage)';
      }

      if (symptom.category === 'obstetric' && patient.isPregnant) {
        const gestation = patient.gestationWeeks || 0;
        if (gestation > 20 && vitals.systolicBloodPressure >= 140) {
          if (symptom.hasSevereAbdominalPain || symptom.isThunderclapHeadache || vitals.systolicBloodPressure >= 160) {
            return 'Severe preeclampsia / impending eclampsia risk criteria met';
          }
        }
        if (gestation < 12 && symptom.hasSevereAbdominalPain && symptom.hasVaginalBleeding) {
          return 'Ruptured ectopic pregnancy risk in early gestation with severe pain and bleeding';
        }
      }

      if (symptom.category === 'trauma') {
        if (symptom.bodySurfaceAreaBurnPercentage && symptom.bodySurfaceAreaBurnPercentage >= 15) {
          return `Moderate to major burn injury (${symptom.bodySurfaceAreaBurnPercentage}% BSA)`;
        }
        if (symptom.burnIncludesFaceHandGroin) {
          return 'Critical burn location involving face, hands, feet, or perineum';
        }
      }

      if (symptom.category === 'gastrointestinal' && symptom.hasActiveBleeding && vitals.heartRate > 110) {
        return 'Active gastrointestinal hemorrhage with hemodynamic compensation';
      }
    }

    return null;
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
    if (news2Score >= 5) {
      return `Elevated NEWS2 Aggregate Risk Score (${news2Score}) requiring urgent medical evaluation`;
    }

    if (vitals.temperatureCelsius >= 39.0) {
      return `High fever (${vitals.temperatureCelsius}°C) exceeding standard pyrexia thresholds`;
    }

    if (vitals.bloodGlucoseMgDl !== undefined) {
      if (vitals.bloodGlucoseMgDl > 300 || vitals.bloodGlucoseMgDl < 60) {
        return `Significant glycemic dysregulation (${vitals.bloodGlucoseMgDl} mg/dL)`;
      }
    }

    if (vitals.painScale >= 7) {
      return `Severe acute physical pain rating (${vitals.painScale}/10)`;
    }

    if (vitals.systolicBloodPressure < 100 && !isPediatric) {
      if (this.hasMedication(patient, m => m.isBetaBlocker)) {
        secondaryFactors.push('Borderline hypotension blunted by concurrent beta-blocker therapy');
      }
      return `Borderline hypotension (Systolic BP ${vitals.systolicBloodPressure} mmHg)`;
    }

    if (vitals.heartRate >= 110 || vitals.heartRate <= 50) {
      return `Moderate heart rate abnormality (${vitals.heartRate} bpm)`;
    }

    for (const symptom of symptoms) {
      if (symptom.category === 'gastrointestinal' && symptom.hasSevereAbdominalPain) {
        return 'Acute moderate-to-severe abdominal pain requiring diagnostic rule-out of acute abdomen';
      }

      if (symptom.category === 'respiratory' && (symptom.hasWheezing || symptom.associatedWithShortnessOfBreath)) {
        return 'Moderate respiratory distress / bronchospasm presentation';
      }

      if (symptom.hasCalfPainOrSwelling && symptom.associatedWithShortnessOfBreath) {
        return 'Suspected deep vein thrombosis with potential pulmonary embolism threat';
      }

      if (symptom.category === 'trauma' && symptom.lossOfConsciousness) {
        const duration = symptom.lossOfConsciousnessDurationMinutes || 0;
        if (duration < 5) {
          return 'Head injury with transient loss of consciousness (< 5 mins)';
        }
      }

      if (symptom.category === 'obstetric' && patient.isPregnant) {
        if (symptom.hasVaginalBleeding || symptom.hasFluidLeakage) {
          return 'Obstetric evaluation required for vaginal bleeding or fluid leakage';
        }
      }
    }

    if (isGeriatric) {
      let riskFactorCount = 0;
      if (patient.chronicConditions.length >= 3) riskFactorCount++;
      if (vitals.respiratoryRate > 20) riskFactorCount++;
      if (vitals.heartRate > 90) riskFactorCount++;
      
      if (riskFactorCount >= 2) {
        return 'Geriatric patient with multiple subtle physiological abnormalities and comorbidities';
      }
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
      if (symptom.category === 'trauma') {
        return 'Uncomplicated minor extremity injury, sprain, or simple laceration';
      }
      if (symptom.category === 'gastrointestinal' && !symptom.hasSevereAbdominalPain && !symptom.hasActiveBleeding) {
        return 'Mild gastrointestinal upset, emesis, or uncomplicated diarrhea';
      }
      if (symptom.category === 'respiratory' && !symptom.associatedWithShortnessOfBreath) {
        return 'Upper respiratory tract infection symptoms without dyspnea';
      }
    }

    if (symptoms.length > 0) {
      return 'Simple single-system mild symptom presentation';
    }

    return null;
  }

  private calculateNEWS2Score(vitals: VitalSigns, patient: PatientProfile): number {
    let score = 0;

    score += this.getNEWS2RespiratoryRateScore(vitals.respiratoryRate);
    score += this.getNEWS2OxygenScore(vitals, this.hasCondition(patient, c => c.isCOPD));

    if (vitals.supplementalOxygen) {
      score += 2;
    }

    score += this.getNEWS2SystolicBPScore(vitals.systolicBloodPressure);
    score += this.getNEWS2HeartRateScore(vitals.heartRate);

    if (vitals.glasgowComaScale < 15) {
      score += 3;
    }

    score += this.getNEWS2TemperatureScore(vitals.temperatureCelsius);

    return score;
  }

  private getNEWS2RespiratoryRateScore(rr: number): number {
    if (rr <= 8) return 3;
    if (rr <= 11) return 1;
    if (rr <= 20) return 0;
    if (rr <= 24) return 2;
    return 3;
  }

  private getNEWS2OxygenScore(vitals: VitalSigns, isCopd: boolean): number {
    const sat = vitals.oxygenSaturation;
    if (!isCopd) {
      if (sat <= 91) return 3;
      if (sat <= 93) return 2;
      if (sat <= 95) return 1;
      return 0;
    }

    if (sat <= 83) return 3;
    if (sat <= 85) return 2;
    if (sat <= 87) return 1;
    if (sat <= 92) return 0;

    if (vitals.supplementalOxygen) {
      if (sat <= 94) return 1;
      if (sat <= 96) return 2;
      return 3;
    }

    return 0;
  }

  private getNEWS2SystolicBPScore(sbp: number): number {
    if (sbp <= 90) return 3;
    if (sbp <= 100) return 2;
    if (sbp <= 110) return 1;
    if (sbp <= 219) return 0;
    return 3;
  }

  private getNEWS2HeartRateScore(hr: number): number {
    if (hr <= 40) return 3;
    if (hr <= 50) return 1;
    if (hr <= 90) return 0;
    if (hr <= 110) return 1;
    if (hr <= 130) return 2;
    return 3;
  }

  private getNEWS2TemperatureScore(temp: number): number {
    if (temp <= 35.0) return 3;
    if (temp <= 36.0) return 1;
    if (temp <= 38.0) return 0;
    if (temp <= 39.0) return 1;
    return 2;
  }

  private calculateSIRS(vitals: VitalSigns, patient: PatientProfile): number {
    let sirs = 0;

    if (vitals.temperatureCelsius > 38.0 || vitals.temperatureCelsius < 36.0) {
      sirs++;
    }

    const isOnBetaBlocker = this.hasMedication(patient, m => m.isBetaBlocker);
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

    return symptoms.some(symptom => {
      const lowerName = symptom.name.toLowerCase();
      return (
        symptom.category === 'infectious' ||
        (symptom.category === 'respiratory' && lowerName.includes('cough')) ||
        (symptom.category === 'gastrointestinal' && lowerName.includes('diarrhea'))
      );
    });
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
            } else {
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

  private evaluateSTEMIPathway(
    patient: PatientProfile,
    symptoms: Symptom[],
    vitals: VitalSigns,
    secondaryFactors: string[]
  ): boolean {
    for (const symptom of symptoms) {
      if (symptom.category === 'cardiovascular') {
        let acuteChestPainScore = 0;

        if (symptom.isSuddenOnset) acuteChestPainScore += 2;
        if (symptom.radiatesToJawOrArm) acuteChestPainScore += 3;
        if (symptom.associatedWithDiaphoresis) acuteChestPainScore += 2;
        if (symptom.associatedWithShortnessOfBreath) acuteChestPainScore += 1;

        if (patient.ageYears > 45 && patient.gender === Gender.MALE) acuteChestPainScore += 1;
        if (patient.ageYears > 55 && patient.gender === Gender.FEMALE) acuteChestPainScore += 1;

        const hasCAD = this.hasCondition(patient, c => c.isCAD || c.isDiabetes);
        if (hasCAD) acuteChestPainScore += 2;

        if (acuteChestPainScore >= 5) {
          secondaryFactors.push(`High risk ACS presentation score (${acuteChestPainScore} points)`);
          return true;
        }
      }
    }
    return false;
  }

  private evaluateAnaphylaxisPathway(symptoms: Symptom[], secondaryFactors: string[]): boolean {
    let affectedSystems = 0;
    let hasAirwaySkin = false;

    for (const symptom of symptoms) {
      if (symptom.isAllergicReaction) {
        if (symptom.hasAirwaySwelling || symptom.hasStridor || symptom.hasWheezing) {
          affectedSystems++;
          hasAirwaySkin = true;
        }
        if (symptom.hasHives) {
          affectedSystems++;
          hasAirwaySkin = true;
        }
        if (symptom.category === 'gastrointestinal' && symptom.hasSevereAbdominalPain) {
          affectedSystems++;
        }
        if (symptom.category === 'cardiovascular') {
          affectedSystems++;
        }
      }
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

  private hasCondition(patient: PatientProfile, predicate: (c: ChronicCondition) => boolean | undefined): boolean {
    return patient.chronicConditions.some(c => Boolean(predicate(c)));
  }

  private hasMedication(patient: PatientProfile, predicate: (m: Medication) => boolean | undefined): boolean {
    return patient.medications.some(m => Boolean(predicate(m)));
  }

  private checkIsNeonate(patient: PatientProfile): boolean {
    return (patient.ageDays !== undefined && patient.ageDays <= 28) || (patient.ageYears === 0 && patient.ageDays === undefined);
  }

  private buildResult(
    triageLevel: TriageLevel,
    primaryReason: string,
    secondaryFactors: string[],
    news2Score: number,
    sirsCriteriaMet: number,
    isSepsisSuspected: boolean,
    isStrokePathwayTriggered: boolean,
    isSTEMIPathwayTriggered: boolean,
    isAnaphylaxisTriggered: boolean,
    recommendedInterventions: string[]
  ): TriageAssessmentResult {
    return {
      triageLevel,
      primaryReason,
      secondaryFactors,
      news2Score,
      sirsCriteriaMet,
      isSepsisSuspected,
      isStrokePathwayTriggered,
      isSTEMIPathwayTriggered,
      isAnaphylaxisTriggered,
      recommendedInterventions,
      evaluatedAt: new Date(),
    };
  }
}