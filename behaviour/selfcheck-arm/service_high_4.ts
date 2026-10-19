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

  private checkLevel1Resuscitation(
    patient: PatientProfile,
    vitals: VitalSigns,
    symptoms: Symptom[],
    isAnaphylaxis: boolean
  ): string | null {
    if (vitals.glasgowComaScale < 8) {
      return 'Severe neurological compromise (GCS <= 8) requiring immediate airway protection';
    }

    if (vitals.respiratoryRate <= 6 || vitals.respiratoryRate >= 45) {
      return `Extreme respiratory rate dysfunction (${vitals.respiratoryRate}/min) indicating impending arrest`;
    }

    const isCopd = patient.chronicConditions.some(c => c.isCOPD);
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
      for (const symptom of symptoms) {
        if (symptom.category === 'neurological' || symptom.category === 'cardiovascular' || symptom.isThunderclapHeadache) {
          return 'Hypertensive emergency with acute end-organ dysfunction signs';
        }
      }
      secondaryFactors.push('Asymptomatic or minimally symptomatic severe hypertension');
    }

    if (isSepsisSuspected && (vitals.systolicBloodPressure < 90 || vitals.glasgowComaScale < 15 || vitals.respiratoryRate >= 22)) {
      return 'Severe sepsis / high risk for septic shock development';
    }

    const isImmunocompromised = patient.chronicConditions.some(c => c.isImmunocompromised || c.isActiveMalignancy) ||
      patient.medications.some(m => m.isImmunosuppressant);

    if (isImmunocompromised && vitals.temperatureCelsius >= 38.3) {
      return 'Neutropenic fever / febrile immunocompromised host requiring immediate parenteral antibiotics';
    }

    const isOnAnticoagulant = patient.medications.some(m => m.isAnticoagulant || m.isAntiplatelet);
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

    if (vitals.oxygenSaturation < 90 && !patient.chronicConditions.some(c => c.isCOPD)) {
      return `Severe arterial hypoxia (SpO2 ${vitals.oxygenSaturation}%)`;
    }

    if (vitals.painScale >= 8) {
      let isHighRiskPainContext = false;
      for (const symptom of symptoms) {
        if (symptom.category === 'cardiovascular' || symptom.category === 'gastrointestinal' || symptom.category === 'obstetric') {
          isHighRiskPainContext = true;
          break;
        }
      }
      if (isHighRiskPainContext) {
        return `Severe acute unmanaged pain (${vitals.painScale}/10) in high-risk anatomical domain`;
      }
    }

    if (isGeriatric && vitals.temperatureCelsius < 35.0) {
      return `Geriatric profound hypothermia (${vitals.temperatureCelsius}°C)`;
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
      const isOnBetaBlocker = patient.medications.some(m => m.isBetaBlocker);
      if (isOnBetaBlocker) {
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

    if (vitals.respiratoryRate <= 8) score += 3;
    else if (vitals.respiratoryRate >= 9 && vitals.respiratoryRate <= 11) score += 1;
    else if (vitals.respiratoryRate >= 12 && vitals.respiratoryRate <= 20) score += 0;
    else if (vitals.respiratoryRate >= 21 && vitals.respiratoryRate <= 24) score += 2;
    else if (vitals.respiratoryRate >= 25) score += 3;

    const isCopd = patient.chronicConditions.some(c => c.isCOPD);
    if (!isCopd) {
      if (vitals.oxygenSaturation <= 91) score += 3;
      else if (vitals.oxygenSaturation >= 92 && vitals.oxygenSaturation <= 93) score += 2;
      else if (vitals.oxygenSaturation >= 94 && vitals.oxygenSaturation <= 95) score += 1;
      else score += 0;
    } else {
      if (vitals.oxygenSaturation <= 83) score += 3;
      else if (vitals.oxygenSaturation >= 84 && vitals.oxygenSaturation <= 85) score += 2;
      else if (vitals.oxygenSaturation >= 86 && vitals.oxygenSaturation <= 87) score += 1;
      else if (vitals.oxygenSaturation >= 88 && vitals.oxygenSaturation <= 92) score += 0;
      else if (vitals.oxygenSaturation >= 93 && vitals.oxygenSaturation <= 94 && vitals.supplementalOxygen) score += 1;
      else if (vitals.oxygenSaturation >= 95 && vitals.oxygenSaturation <= 96 && vitals.supplementalOxygen) score += 2;
      else if (vitals.oxygenSaturation >= 97 && vitals.supplementalOxygen) score += 3;
    }

    if (vitals.supplementalOxygen) {
      score += 2;
    }

    if (vitals.systolicBloodPressure <= 90) score += 3;
    else if (vitals.systolicBloodPressure >= 91 && vitals.systolicBloodPressure <= 100) score += 2;
    else if (vitals.systolicBloodPressure >= 101 && vitals.systolicBloodPressure <= 110) score += 1;
    else if (vitals.systolicBloodPressure >= 111 && vitals.systolicBloodPressure <= 219) score += 0;
    else if (vitals.systolicBloodPressure >= 220) score += 3;

    if (vitals.heartRate <= 40) score += 3;
    else if (vitals.heartRate >= 41 && vitals.heartRate <= 50) score += 1;
    else if (vitals.heartRate >= 51 && vitals.heartRate <= 90) score += 0;
    else if (vitals.heartRate >= 91 && vitals.heartRate <= 110) score += 1;
    else if (vitals.heartRate >= 111 && vitals.heartRate <= 130) score += 2;
    else if (vitals.heartRate >= 131) score += 3;

    if (vitals.glasgowComaScale < 15) {
      score += 3;
    }

    if (vitals.temperatureCelsius <= 35.0) score += 3;
    else if (vitals.temperatureCelsius >= 35.1 && vitals.temperatureCelsius <= 36.0) score += 1;
    else if (vitals.temperatureCelsius >= 36.1 && vitals.temperatureCelsius <= 38.0) score += 0;
    else if (vitals.temperatureCelsius >= 38.1 && vitals.temperatureCelsius <= 39.0) score += 1;
    else if (vitals.temperatureCelsius >= 39.1) score += 2;

    return score;
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

        const hasCAD = patient.chronicConditions.some(c => c.isCAD || c.isDiabetes);
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
}
