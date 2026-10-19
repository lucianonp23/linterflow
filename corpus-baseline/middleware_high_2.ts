import { Injectable, NestMiddleware, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export type AcademicLevel = 4 | 5 | 6 | 7 | 8;

export type ECReason = 
  | 'MEDICAL' 
  | 'BEREAVEMENT' 
  | 'TECHNICAL' 
  | 'ACADEMIC_CONCESSION' 
  | 'DISREGARD' 
  | 'UNCAPPED_RESIT';

export interface ExtenuatingCircumstance {
  id: string;
  code: ECReason;
  approved: boolean;
  affectedComponentIds: string[];
  extensionDays?: number;
}

export interface ComponentAttempt {
  attemptNumber: number;
  rawMark: number;
  maxMark: number;
  submissionDate: string;
  dueDate: string;
  isResit: boolean;
  plagiarismPenaltyPercentage?: number;
  wordCountPenaltyPercentage?: number;
}

export interface AssessmentComponent {
  id: string;
  name: string;
  weight: number;
  isMandatoryPass: boolean;
  mandatoryPassThreshold?: number;
  attempts: ComponentAttempt[];
}

export interface CourseModule {
  code: string;
  title: string;
  credits: number;
  level: AcademicLevel;
  isCore: boolean;
  isNonCompensable: boolean;
  requiresProfessionalAccreditation: boolean;
  components: AssessmentComponent[];
}

export interface StudentPayload {
  studentId: string;
  programCode: string;
  academicYear: string;
  stage: number;
  cumulativeCompensatedCredits: number;
  cumulativeResitCredits: number;
  extenuatingCircumstances: ExtenuatingCircumstance[];
  modules: CourseModule[];
}

export interface ProcessedComponentResult {
  componentId: string;
  name: string;
  originalWeight: number;
  effectiveWeight: number;
  finalPercentage: number;
  isDisregarded: boolean;
  isMandatoryFailed: boolean;
  penaltiesApplied: {
    latePenalty: number;
    plagiarismPenalty: number;
    wordCountPenalty: number;
  };
  warnings: string[];
}

export interface ProcessedModuleResult {
  moduleCode: string;
  credits: number;
  level: AcademicLevel;
  finalPercentage: number;
  status: 'PASSED' | 'PASSED_BY_COMPENSATION' | 'FAILED_RESIT_ALLOWED' | 'FAILED_NO_RESIT' | 'DEFERRED' | 'PENDING_EC';
  isCompensated: boolean;
  creditsAwarded: number;
  resitEligibility: {
    eligible: boolean;
    reason: string;
    componentsToResit: string[];
    isUncapped: boolean;
  };
  componentResults: ProcessedComponentResult[];
  auditLogs: string[];
}

export interface ProgressionDecision {
  academicStanding: 'GOOD_STANDING' | 'PROBATION' | 'ACADEMIC_WARNING' | 'REQUIRED_TO_WITHDRAW' | 'SUSPENDED' | 'PENDING_RESITS';
  canProgressToNextStage: boolean;
  totalCreditsAttempted: number;
  totalCreditsEarned: number;
  totalCompensatedCredits: number;
  stageWeightedAverage: number;
  projectedClassification?: 'FIRST_CLASS' | 'UPPER_SECOND' | 'LOWER_SECOND' | 'THIRD_CLASS' | 'DISTINCTION' | 'MERIT' | 'PASS' | 'FAIL';
  actionRequired?: string;
  auditTrail: string[];
}

export interface EnrichedGradingContext {
  studentId: string;
  programCode: string;
  academicYear: string;
  stage: number;
  processedModules: ProcessedModuleResult[];
  progression: ProgressionDecision;
  evaluatedAt: string;
}

declare global {
  namespace Express {
    interface Request {
      gradingContext?: EnrichedGradingContext;
    }
  }
}

interface StageAccumulator {
  totalWeightedMark: number;
  totalCreditsAttempted: number;
  totalCreditsEarned: number;
  compensatedCredits: number;
  failedCredits: number;
  pendingResitsCount: number;
}

@Injectable()
export class StudentGradingAndProgressionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (this.shouldSkipRequest(req)) {
      return next();
    }

    const payload = req.body as StudentPayload;
    this.validatePayloadIntegrity(payload);

    const auditTrail: string[] = [
      `Starting evaluation for Student ${payload.studentId} [Program: ${payload.programCode}, Stage: ${payload.stage}]`
    ];

    const processedModules: ProcessedModuleResult[] = [];
    const stageAcc: StageAccumulator = {
      totalWeightedMark: 0,
      totalCreditsAttempted: 0,
      totalCreditsEarned: 0,
      compensatedCredits: 0,
      failedCredits: 0,
      pendingResitsCount: 0
    };

    for (const module of payload.modules) {
      const processed = this.processModule(payload, module, stageAcc);
      processedModules.push(processed);
    }

    const stageWeightedAverage = stageAcc.totalCreditsAttempted > 0 
      ? Math.round((stageAcc.totalWeightedMark / stageAcc.totalCreditsAttempted) * 100) / 100 
      : 0;

    const progressionDecision = this.determineProgression(
      payload,
      processedModules,
      stageAcc.totalCreditsAttempted,
      stageAcc.totalCreditsEarned,
      stageAcc.compensatedCredits,
      stageAcc.failedCredits,
      stageAcc.pendingResitsCount,
      stageWeightedAverage,
      auditTrail
    );

    req.gradingContext = {
      studentId: payload.studentId,
      programCode: payload.programCode,
      academicYear: payload.academicYear,
      stage: payload.stage,
      processedModules,
      progression: progressionDecision,
      evaluatedAt: new Date().toISOString()
    };

    next();
  }

  private shouldSkipRequest(req: Request): boolean {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return true;
    }
    if (!req.body || typeof req.body !== 'object') {
      return true;
    }
    const payload = req.body as StudentPayload;
    return !payload.studentId || !payload.modules || !Array.isArray(payload.modules) || payload.modules.length === 0;
  }

  private validatePayloadIntegrity(payload: StudentPayload): void {
    if (typeof payload.stage !== 'number' || payload.stage < 1 || payload.stage > 6) {
      throw new BadRequestException('Invalid academic stage provided.');
    }

    for (const m of payload.modules) {
      if (!m.code || !m.credits || !m.components || !Array.isArray(m.components)) {
        throw new BadRequestException(`Malformed module structure for module code: ${m.code || 'UNKNOWN'}`);
      }

      for (const c of m.components) {
        if (!c.attempts || !Array.isArray(c.attempts) || c.attempts.length === 0) {
          throw new UnprocessableEntityException(`Component ${c.id || c.name} in module ${m.code} must have at least one attempt record.`);
        }
      }
    }
  }

  private processModule(payload: StudentPayload, module: CourseModule, stageAcc: StageAccumulator): ProcessedModuleResult {
    const moduleAudit: string[] = [
      `Processing module ${module.code} (Level ${module.level}, ${module.credits} Credits)`
    ];

    const passThreshold = this.getPassThresholdForLevel(module.level, module.requiresProfessionalAccreditation);
    const compensationLowerBound = this.getCompensationLowerBound(module.level);

    let totalModuleWeight = 0;
    let validComponentCount = 0;
    let isAnyComponentDisregarded = false;

    for (const comp of module.components) {
      const isDisregarded = this.isComponentDisregarded(comp.id, payload.extenuatingCircumstances);
      if (isDisregarded) {
        isAnyComponentDisregarded = true;
        moduleAudit.push(`Component ${comp.id} disregarded due to approved EC.`);
      } else {
        totalModuleWeight += comp.weight;
        validComponentCount++;
      }
    }

    if (validComponentCount === 0) {
      return {
        moduleCode: module.code,
        credits: module.credits,
        level: module.level,
        finalPercentage: 0,
        status: 'DEFERRED',
        isCompensated: false,
        creditsAwarded: 0,
        resitEligibility: {
          eligible: true,
          reason: 'All components deferred/disregarded due to Extenuating Circumstances.',
          componentsToResit: module.components.map(c => c.id),
          isUncapped: true
        },
        componentResults: [],
        auditLogs: moduleAudit
      };
    }

    if (Math.abs(totalModuleWeight - 1.0) > 0.001 && !isAnyComponentDisregarded) {
      throw new BadRequestException(`Module ${module.code} component weights do not sum to 1.0 (Sum: ${totalModuleWeight})`);
    }

    const componentResults: ProcessedComponentResult[] = [];
    let aggregatedModuleMark = 0;
    let mandatoryComponentFailed = false;

    for (const comp of module.components) {
      const isDisregarded = this.isComponentDisregarded(comp.id, payload.extenuatingCircumstances);
      if (isDisregarded) {
        componentResults.push({
          componentId: comp.id,
          name: comp.name,
          originalWeight: comp.weight,
          effectiveWeight: 0,
          finalPercentage: 0,
          isDisregarded: true,
          isMandatoryFailed: false,
          penaltiesApplied: { latePenalty: 0, plagiarismPenalty: 0, wordCountPenalty: 0 },
          warnings: ['Disregarded due to approved EC']
        });
        continue;
      }

      const res = this.processComponent(payload, module, comp, totalModuleWeight, passThreshold);
      if (res.isMandatoryFailed) {
        mandatoryComponentFailed = true;
      }
      aggregatedModuleMark += res.weightedMark;
      componentResults.push(res.result);
    }

    let finalModulePercentage = Math.round(aggregatedModuleMark * 100) / 100;
    if (mandatoryComponentFailed && finalModulePercentage >= passThreshold) {
      moduleAudit.push(`Module overall mark is ${finalModulePercentage}%, but mandatory component failed. Capping module score to pass boundary - 1.`);
      finalModulePercentage = passThreshold - 1;
    }

    let moduleStatus: ProcessedModuleResult['status'] = 'FAILED_NO_RESIT';
    let isCompensated = false;
    let creditsAwarded = 0;
    const resitComponents: string[] = [];
    let isResitUncapped = false;

    if (finalModulePercentage >= passThreshold && !mandatoryComponentFailed) {
      moduleStatus = 'PASSED';
      creditsAwarded = module.credits;
      stageAcc.totalCreditsEarned += module.credits;
    } else {
      const totalCompensatedSoFar = payload.cumulativeCompensatedCredits + stageAcc.compensatedCredits;
      const maxCompensableCredits = this.getMaxCompensableCreditsForLevel(module.level);

      const allowCompensation = 
        !module.isCore &&
        !module.isNonCompensable &&
        !module.requiresProfessionalAccreditation &&
        finalModulePercentage >= compensationLowerBound &&
        finalModulePercentage < passThreshold &&
        !mandatoryComponentFailed &&
        (totalCompensatedSoFar + module.credits) <= maxCompensableCredits;

      if (allowCompensation) {
        moduleStatus = 'PASSED_BY_COMPENSATION';
        isCompensated = true;
        creditsAwarded = module.credits;
        stageAcc.totalCreditsEarned += module.credits;
        stageAcc.compensatedCredits += module.credits;
        moduleAudit.push(`Module passed via compensation (${finalModulePercentage}%).`);
      } else {
        stageAcc.failedCredits += module.credits;

        for (const cr of componentResults) {
          if (!cr.isDisregarded && cr.finalPercentage < passThreshold) {
            resitComponents.push(cr.componentId);
          }
        }

        const hasResitAttemptsLeft = module.components.every(c => c.attempts.length < 3);
        const hasUncappedEC = payload.extenuatingCircumstances.some(ec => 
          ec.approved && (ec.code === 'UNCAPPED_RESIT' || ec.code === 'TECHNICAL') &&
          ec.affectedComponentIds.some(id => module.components.some(mc => mc.id === id))
        );

        if (hasUncappedEC) {
          isResitUncapped = true;
        }

        if (hasResitAttemptsLeft || isResitUncapped) {
          moduleStatus = 'FAILED_RESIT_ALLOWED';
          stageAcc.pendingResitsCount++;
        } else {
          moduleStatus = 'FAILED_NO_RESIT';
        }
      }
    }

    stageAcc.totalWeightedMark += finalModulePercentage * module.credits;
    stageAcc.totalCreditsAttempted += module.credits;

    return {
      moduleCode: module.code,
      credits: module.credits,
      level: module.level,
      finalPercentage: finalModulePercentage,
      status: moduleStatus,
      isCompensated,
      creditsAwarded,
      resitEligibility: {
        eligible: moduleStatus === 'FAILED_RESIT_ALLOWED',
        reason: moduleStatus === 'FAILED_RESIT_ALLOWED' 
          ? (isResitUncapped ? 'Eligible for uncapped resit due to approved EC' : 'Eligible for capped resit') 
          : 'No resit eligible or max attempts reached',
        componentsToResit: resitComponents,
        isUncapped: isResitUncapped
      },
      componentResults,
      auditLogs: moduleAudit
    };
  }

  private processComponent(
    payload: StudentPayload,
    module: CourseModule,
    comp: AssessmentComponent,
    totalModuleWeight: number,
    passThreshold: number
  ): { result: ProcessedComponentResult; weightedMark: number; isMandatoryFailed: boolean } {
    const effectiveWeight = comp.weight / totalModuleWeight;
    const latestAttempt = this.getLatestAttempt(comp.attempts);

    if (!latestAttempt) {
      throw new UnprocessableEntityException(`Component ${comp.id} in module ${module.code} has no submission attempts.`);
    }

    let calcMark = (latestAttempt.rawMark / latestAttempt.maxMark) * 100;
    const penalties = { latePenalty: 0, plagiarismPenalty: 0, wordCountPenalty: 0 };
    const compWarnings: string[] = [];

    const ecForComp = this.getECForComponent(comp.id, payload.extenuatingCircumstances);
    const extensionDays = ecForComp?.extensionDays || 0;

    if (latestAttempt.submissionDate && latestAttempt.dueDate) {
      const lateDays = this.calculateLateDays(latestAttempt.dueDate, latestAttempt.submissionDate, extensionDays);
      if (lateDays > 0) {
        if (ecForComp && ecForComp.code === 'ACADEMIC_CONCESSION') {
          compWarnings.push('Late penalty waived due to Academic Concession.');
        } else {
          penalties.latePenalty = Math.min(lateDays * 5, 100);
          calcMark = Math.max(0, calcMark - penalties.latePenalty);
          compWarnings.push(`Late submission by ${lateDays} day(s). Deducted ${penalties.latePenalty}%.`);
        }
      }
    }

    if (latestAttempt.plagiarismPenaltyPercentage && latestAttempt.plagiarismPenaltyPercentage > 0) {
      penalties.plagiarismPenalty = latestAttempt.plagiarismPenaltyPercentage;
      calcMark = Math.max(0, calcMark - penalties.plagiarismPenalty);
      compWarnings.push(`Plagiarism penalty applied: -${penalties.plagiarismPenalty}%.`);
    }

    if (latestAttempt.wordCountPenaltyPercentage && latestAttempt.wordCountPenaltyPercentage > 0) {
      penalties.wordCountPenalty = latestAttempt.wordCountPenaltyPercentage;
      calcMark = Math.max(0, calcMark - penalties.wordCountPenalty);
      compWarnings.push(`Word count penalty applied: -${penalties.wordCountPenalty}%.`);
    }

    const isUncappedResit = ecForComp?.code === 'UNCAPPED_RESIT';
    if (latestAttempt.isResit && !isUncappedResit) {
      const cap = passThreshold;
      if (calcMark > cap) {
        compWarnings.push(`Resit mark capped from ${calcMark.toFixed(2)}% to pass mark ${cap}%.`);
        calcMark = cap;
      }
    }

    let isMandatoryFailed = false;
    if (comp.isMandatoryPass) {
      const reqThreshold = comp.mandatoryPassThreshold ?? passThreshold;
      if (calcMark < reqThreshold) {
        isMandatoryFailed = true;
        compWarnings.push(`Failed mandatory component threshold (${calcMark.toFixed(2)}% < ${reqThreshold}%).`);
      }
    }

    const weightedMark = calcMark * effectiveWeight;

    return {
      result: {
        componentId: comp.id,
        name: comp.name,
        originalWeight: comp.weight,
        effectiveWeight,
        finalPercentage: Math.round(calcMark * 100) / 100,
        isDisregarded: false,
        isMandatoryFailed,
        penaltiesApplied: penalties,
        warnings: compWarnings
      },
      weightedMark,
      isMandatoryFailed
    };
  }

  private getPassThresholdForLevel(level: AcademicLevel, requiresProfessionalAccreditation: boolean): number {
    if (requiresProfessionalAccreditation) {
      return 50.0;
    }
    switch (level) {
      case 4:
      case 5:
      case 6:
        return 40.0;
      case 7:
        return 50.0;
      case 8:
        return 60.0;
      default:
        return 40.0;
    }
  }

  private getCompensationLowerBound(level: AcademicLevel): number {
    switch (level) {
      case 4:
      case 5:
      case 6:
        return 30.0;
      case 7:
        return 40.0;
      case 8:
        return 60.0;
      default:
        return 30.0;
    }
  }

  private getMaxCompensableCreditsForLevel(level: AcademicLevel): number {
    switch (level) {
      case 4:
      case 5:
      case 6:
        return 30;
      case 7:
        return 15;
      case 8:
        return 0;
      default:
        return 30;
    }
  }

  private isComponentDisregarded(componentId: string, ecs: ExtenuatingCircumstance[]): boolean {
    return ecs.some(ec => 
      ec.approved && 
      ec.code === 'DISREGARD' && 
      ec.affectedComponentIds.includes(componentId)
    );
  }

  private getECForComponent(componentId: string, ecs: ExtenuatingCircumstance[]): ExtenuatingCircumstance | undefined {
    return ecs.find(ec => ec.approved && ec.affectedComponentIds.includes(componentId));
  }

  private getLatestAttempt(attempts: ComponentAttempt[]): ComponentAttempt {
    return attempts.reduce((prev, current) => 
      (prev.attemptNumber > current.attemptNumber) ? prev : current
    );
  }

  private calculateLateDays(dueDateStr: string, submissionDateStr: string, extensionDays: number): number {
    const due = new Date(dueDateStr);
    due.setDate(due.getDate() + extensionDays);
    const sub = new Date(submissionDateStr);

    const diffTime = sub.getTime() - due.getTime();
    if (diffTime <= 0) return 0;

    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  private determineProgression(
    payload: StudentPayload,
    modules: ProcessedModuleResult[],
    totalAttempted: number,
    totalEarned: number,
    compensatedCredits: number,
    failedCredits: number,
    pendingResitsCount: number,
    stageAverage: number,
    auditTrail: string[]
  ): ProgressionDecision {
    let academicStanding: ProgressionDecision['academicStanding'] = 'GOOD_STANDING';
    let canProgress = false;
    let actionRequired: string | undefined;

    const totalCompensated = payload.cumulativeCompensatedCredits + compensatedCredits;

    if (failedCredits === 0 && pendingResitsCount === 0) {
      canProgress = true;
      academicStanding = 'GOOD_STANDING';
      auditTrail.push('All modules passed successfully. Clear progression guaranteed.');
    } else if (pendingResitsCount > 0) {
      if (failedCredits > 60) {
        canProgress = false;
        academicStanding = 'REQUIRED_TO_WITHDRAW';
        actionRequired = 'Failed too many credits (> 60). Discontinued from program.';
        auditTrail.push(`Student failed ${failedCredits} credits, exceeding max allowable resit threshold.`);
      } else {
        canProgress = false;
        academicStanding = 'PENDING_RESITS';
        actionRequired = 'Student must complete required resit assessments before progression decision.';
        auditTrail.push(`Student has ${pendingResitsCount} module(s) pending resits.`);
      }
    } else if (failedCredits > 0) {
      if (failedCredits <= 30 && stageAverage >= 50.0) {
        canProgress = true;
        academicStanding = 'PROBATION';
        actionRequired = 'Allowed to progress on academic probation with trailing credits.';
        auditTrail.push('Progressed on probation under trailing credit rule.');
      } else if (failedCredits <= 40 && stageAverage >= 40.0) {
        canProgress = false;
        academicStanding = 'ACADEMIC_WARNING';
        actionRequired = 'Must repeat failed modules in the upcoming academic year.';
        auditTrail.push('Repeat year mandated due to uncompensated module failures.');
      } else {
        canProgress = false;
        academicStanding = 'REQUIRED_TO_WITHDRAW';
        actionRequired = 'Excessive credit failure. Exited from program.';
        auditTrail.push(`Academic standing set to REQUIRED_TO_WITHDRAW due to ${failedCredits} failed credits.`);
      }
    }

    let projectedClassification: ProgressionDecision['projectedClassification'];
    if (payload.stage >= 3) {
      projectedClassification = this.calculateClassification(stageAverage, modules);
      auditTrail.push(`Projected Classification calculated as: ${projectedClassification}`);
    }

    return {
      academicStanding,
      canProgressToNextStage: canProgress,
      totalCreditsAttempted: totalAttempted,
      totalCreditsEarned: totalEarned,
      totalCompensatedCredits: totalCompensated,
      stageWeightedAverage: stageAverage,
      projectedClassification,
      actionRequired,
      auditTrail
    };
  }

  private calculateClassification(stageAverage: number, modules: ProcessedModuleResult[]): ProgressionDecision['projectedClassification'] {
    const isLevel7 = modules.some(m => m.level === 7);

    if (isLevel7) {
      if (stageAverage >= 70.0) return 'DISTINCTION';
      if (stageAverage >= 60.0) return 'MERIT';
      if (stageAverage >= 50.0) return 'PASS';
      return 'FAIL';
    } else {
      if (stageAverage >= 70.0) return 'FIRST_CLASS';
      if (stageAverage >= 60.0) return 'UPPER_SECOND';
      if (stageAverage >= 50.0) return 'LOWER_SECOND';
      if (stageAverage >= 40.0) return 'THIRD_CLASS';
      return 'FAIL';
    }
  }
}