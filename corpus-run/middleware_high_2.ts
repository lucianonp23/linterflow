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

@Injectable()
export class StudentGradingAndProgressionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.isEligibleForGrading(req)) {
      return next();
    }

    const payload = req.body as StudentPayload;
    this.validatePayloadIntegrity(payload);

    const auditTrail: string[] = [
      `Starting evaluation for Student ${payload.studentId} [Program: ${payload.programCode}, Stage: ${payload.stage}]`
    ];

    const processedModules: ProcessedModuleResult[] = [];
    let stageTotalWeightedMark = 0;
    let stageTotalCreditsAttempted = 0;
    let stageTotalCreditsEarned = 0;
    let stageCompensatedCredits = 0;
    let stageFailedCredits = 0;
    let pendingResitsCount = 0;

    for (const module of payload.modules) {
      const moduleOutcome = this.processSingleModule(module, payload, stageCompensatedCredits);
      processedModules.push(moduleOutcome.result);
      stageTotalWeightedMark += moduleOutcome.weightedMark;
      stageTotalCreditsAttempted += moduleOutcome.creditsAttempted;
      stageTotalCreditsEarned += moduleOutcome.creditsEarned;
      stageCompensatedCredits += moduleOutcome.compensatedCredits;
      stageFailedCredits += moduleOutcome.failedCredits;
      if (moduleOutcome.pendingResit) {
        pendingResitsCount++;
      }
    }

    const stageWeightedAverage = stageTotalCreditsAttempted > 0 
      ? Math.round((stageTotalWeightedMark / stageTotalCreditsAttempted) * 100) / 100 
      : 0;

    const progressionDecision = this.determineProgression(
      payload,
      processedModules,
      stageTotalCreditsAttempted,
      stageTotalCreditsEarned,
      stageCompensatedCredits,
      stageFailedCredits,
      pendingResitsCount,
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

  private isEligibleForGrading(req: Request): boolean {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return false;
    }
    if (!req.body || typeof req.body !== 'object') {
      return false;
    }
    const payload = req.body as StudentPayload;
    if (!payload.studentId || !payload.modules || !Array.isArray(payload.modules) || payload.modules.length === 0) {
      return false;
    }
    return true;
  }

  private processSingleModule(
    module: CourseModule,
    payload: StudentPayload,
    stageCompensatedCredits: number
  ): {
    result: ProcessedModuleResult;
    creditsEarned: number;
    compensatedCredits: number;
    failedCredits: number;
    pendingResit: boolean;
    weightedMark: number;
    creditsAttempted: number;
  } {
    const moduleAudit: string[] = [`Processing module ${module.code} (Level ${module.level}, ${module.credits} Credits)`];
    const { totalModuleWeight, validComponentCount, isAnyComponentDisregarded } = 
      this.evaluateModuleWeights(module, payload.extenuatingCircumstances, moduleAudit);

    if (validComponentCount === 0) {
      return {
        result: this.createDeferredModuleResult(module, moduleAudit),
        creditsEarned: 0,
        compensatedCredits: 0,
        failedCredits: 0,
        pendingResit: false,
        weightedMark: 0,
        creditsAttempted: 0
      };
    }

    if (Math.abs(totalModuleWeight - 1.0) > 0.001 && !isAnyComponentDisregarded) {
      throw new BadRequestException(`Module ${module.code} component weights do not sum to 1.0 (Sum: ${totalModuleWeight})`);
    }

    const passThreshold = this.getPassThresholdForLevel(module.level, module.requiresProfessionalAccreditation);
    const componentResults: ProcessedComponentResult[] = [];
    let aggregatedModuleMark = 0;
    let mandatoryComponentFailed = false;

    for (const comp of module.components) {
      const processed = this.processComponent(comp, totalModuleWeight, passThreshold, payload.extenuatingCircumstances, module.code);
      componentResults.push(processed.result);
      aggregatedModuleMark += processed.markContribution;
      if (processed.isMandatoryFailed) {
        mandatoryComponentFailed = true;
      }
    }

    const outcome = this.processModuleOutcome(
      module,
      aggregatedModuleMark,
      mandatoryComponentFailed,
      componentResults,
      payload,
      stageCompensatedCredits,
      moduleAudit
    );

    return {
      ...outcome,
      weightedMark: outcome.result.finalPercentage * module.credits,
      creditsAttempted: module.credits
    };
  }

  private evaluateModuleWeights(
    module: CourseModule,
    ecs: ExtenuatingCircumstance[],
    moduleAudit: string[]
  ): { totalModuleWeight: number; validComponentCount: number; isAnyComponentDisregarded: boolean } {
    let totalModuleWeight = 0;
    let validComponentCount = 0;
    let isAnyComponentDisregarded = false;

    for (const comp of module.components) {
      if (this.isComponentDisregarded(comp.id, ecs)) {
        isAnyComponentDisregarded = true;
        moduleAudit.push(`Component ${comp.id} disregarded due to approved EC.`);
      } else {
        totalModuleWeight += comp.weight;
        validComponentCount++;
      }
    }

    return { totalModuleWeight, validComponentCount, isAnyComponentDisregarded };
  }

  private createDeferredModuleResult(module: CourseModule, moduleAudit: string[]): ProcessedModuleResult {
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

  private processComponent(
    comp: AssessmentComponent,
    totalModuleWeight: number,
    passThreshold: number,
    ecs: ExtenuatingCircumstance[],
    moduleCode: string
  ): { result: ProcessedComponentResult; markContribution: number; isMandatoryFailed: boolean } {
    if (this.isComponentDisregarded(comp.id, ecs)) {
      return this.createDisregardedComponentResult(comp);
    }

    const effectiveWeight = comp.weight / totalModuleWeight;
    const latestAttempt = this.getLatestAttempt(comp.attempts);

    if (!latestAttempt) {
      throw new UnprocessableEntityException(`Component ${comp.id} in module ${moduleCode} has no submission attempts.`);
    }

    const rawMarkPercentage = (latestAttempt.rawMark / latestAttempt.maxMark) * 100;
    const compWarnings: string[] = [];
    const ecForComp = this.getECForComponent(comp.id, ecs);

    const { markAfterPenalties, penalties } = this.applyAttemptPenalties(latestAttempt, ecForComp, rawMarkPercentage, compWarnings);
    let calcMark = markAfterPenalties;

    const isUncappedResit = ecForComp?.code === 'UNCAPPED_RESIT';
    if (latestAttempt.isResit && !isUncappedResit && calcMark > passThreshold) {
      compWarnings.push(`Resit mark capped from ${calcMark.toFixed(2)}% to pass mark ${passThreshold}%.`);
      calcMark = passThreshold;
    }

    const isMandatoryFailed = this.checkMandatoryComponentFailure(comp, calcMark, passThreshold, compWarnings);

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
      markContribution: calcMark * effectiveWeight,
      isMandatoryFailed
    };
  }

  private createDisregardedComponentResult(comp: AssessmentComponent) {
    return {
      result: {
        componentId: comp.id,
        name: comp.name,
        originalWeight: comp.weight,
        effectiveWeight: 0,
        finalPercentage: 0,
        isDisregarded: true,
        isMandatoryFailed: false,
        penaltiesApplied: { latePenalty: 0, plagiarismPenalty: 0, wordCountPenalty: 0 },
        warnings: ['Disregarded due to approved EC']
      },
      markContribution: 0,
      isMandatoryFailed: false
    };
  }

  private applyLatePenalty(
    attempt: ComponentAttempt,
    ecForComp: ExtenuatingCircumstance | undefined,
    warnings: string[]
  ): number {
    if (!attempt.submissionDate || !attempt.dueDate) return 0;
    const extensionDays = ecForComp?.extensionDays || 0;
    const lateDays = this.calculateLateDays(attempt.dueDate, attempt.submissionDate, extensionDays);
    if (lateDays <= 0) return 0;

    if (ecForComp?.code === 'ACADEMIC_CONCESSION') {
      warnings.push('Late penalty waived due to Academic Concession.');
      return 0;
    }

    const latePenalty = Math.min(lateDays * 5, 100);
    warnings.push(`Late submission by ${lateDays} day(s). Deducted ${latePenalty}%.`);
    return latePenalty;
  }

  private applyAttemptPenalties(
    latestAttempt: ComponentAttempt,
    ecForComp: ExtenuatingCircumstance | undefined,
    initialMark: number,
    compWarnings: string[]
  ): { markAfterPenalties: number; penalties: ProcessedComponentResult['penaltiesApplied'] } {
    let calcMark = initialMark;
    const penalties = { latePenalty: 0, plagiarismPenalty: 0, wordCountPenalty: 0 };

    penalties.latePenalty = this.applyLatePenalty(latestAttempt, ecForComp, compWarnings);
    if (penalties.latePenalty > 0) {
      calcMark = Math.max(0, calcMark - penalties.latePenalty);
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

    return { markAfterPenalties: calcMark, penalties };
  }

  private checkMandatoryComponentFailure(
    comp: AssessmentComponent,
    calcMark: number,
    passThreshold: number,
    compWarnings: string[]
  ): boolean {
    if (!comp.isMandatoryPass) return false;
    const reqThreshold = comp.mandatoryPassThreshold ?? passThreshold;
    if (calcMark < reqThreshold) {
      compWarnings.push(`Failed mandatory component threshold (${calcMark.toFixed(2)}% < ${reqThreshold}%).`);
      return true;
    }
    return false;
  }

  private canCompensateModule(
    module: CourseModule,
    finalPercentage: number,
    passThreshold: number,
    mandatoryComponentFailed: boolean,
    totalCompensatedSoFar: number
  ): boolean {
    if (module.isCore || module.isNonCompensable || module.requiresProfessionalAccreditation) {
      return false;
    }
    if (mandatoryComponentFailed) {
      return false;
    }
    const lowerBound = this.getCompensationLowerBound(module.level);
    if (finalPercentage < lowerBound || finalPercentage >= passThreshold) {
      return false;
    }
    const maxCompensable = this.getMaxCompensableCreditsForLevel(module.level);
    return (totalCompensatedSoFar + module.credits) <= maxCompensable;
  }

  private checkUncappedEC(module: CourseModule, ecs: ExtenuatingCircumstance[]): boolean {
    return ecs.some(ec =>
      ec.approved &&
      (ec.code === 'UNCAPPED_RESIT' || ec.code === 'TECHNICAL') &&
      ec.affectedComponentIds.some(id => module.components.some(mc => mc.id === id))
    );
  }

  private processModuleOutcome(
    module: CourseModule,
    aggregatedMark: number,
    mandatoryComponentFailed: boolean,
    componentResults: ProcessedComponentResult[],
    payload: StudentPayload,
    stageCompensatedCredits: number,
    moduleAudit: string[]
  ): {
    result: ProcessedModuleResult;
    creditsEarned: number;
    compensatedCredits: number;
    failedCredits: number;
    pendingResit: boolean;
  } {
    const passThreshold = this.getPassThresholdForLevel(module.level, module.requiresProfessionalAccreditation);
    let finalPercentage = Math.round(aggregatedMark * 100) / 100;

    if (mandatoryComponentFailed && finalPercentage >= passThreshold) {
      moduleAudit.push(`Module overall mark is ${finalPercentage}%, but mandatory component failed. Capping module score to pass boundary - 1.`);
      finalPercentage = passThreshold - 1;
    }

    if (finalPercentage >= passThreshold && !mandatoryComponentFailed) {
      return {
        result: {
          moduleCode: module.code,
          credits: module.credits,
          level: module.level,
          finalPercentage,
          status: 'PASSED',
          isCompensated: false,
          creditsAwarded: module.credits,
          resitEligibility: {
            eligible: false,
            reason: 'No resit eligible or max attempts reached',
            componentsToResit: [],
            isUncapped: false
          },
          componentResults,
          auditLogs: moduleAudit
        },
        creditsEarned: module.credits,
        compensatedCredits: 0,
        failedCredits: 0,
        pendingResit: false
      };
    }

    const totalCompensatedSoFar = payload.cumulativeCompensatedCredits + stageCompensatedCredits;
    const isCompensated = this.canCompensateModule(
      module,
      finalPercentage,
      passThreshold,
      mandatoryComponentFailed,
      totalCompensatedSoFar
    );

    if (isCompensated) {
      moduleAudit.push(`Module passed via compensation (${finalPercentage}%).`);
      return {
        result: {
          moduleCode: module.code,
          credits: module.credits,
          level: module.level,
          finalPercentage,
          status: 'PASSED_BY_COMPENSATION',
          isCompensated: true,
          creditsAwarded: module.credits,
          resitEligibility: {
            eligible: false,
            reason: 'No resit eligible or max attempts reached',
            componentsToResit: [],
            isUncapped: false
          },
          componentResults,
          auditLogs: moduleAudit
        },
        creditsEarned: module.credits,
        compensatedCredits: module.credits,
        failedCredits: 0,
        pendingResit: false
      };
    }

    const resitComponents = componentResults
      .filter(cr => !cr.isDisregarded && cr.finalPercentage < passThreshold)
      .map(cr => cr.componentId);

    const hasResitAttemptsLeft = module.components.every(c => c.attempts.length < 3);
    const isResitUncapped = this.checkUncappedEC(module, payload.extenuatingCircumstances);
    const isResitEligible = hasResitAttemptsLeft || isResitUncapped;
    const status = isResitEligible ? 'FAILED_RESIT_ALLOWED' : 'FAILED_NO_RESIT';

    return {
      result: {
        moduleCode: module.code,
        credits: module.credits,
        level: module.level,
        finalPercentage,
        status,
        isCompensated: false,
        creditsAwarded: 0,
        resitEligibility: {
          eligible: isResitEligible,
          reason: isResitEligible
            ? (isResitUncapped ? 'Eligible for uncapped resit due to approved EC' : 'Eligible for capped resit')
            : 'No resit eligible or max attempts reached',
          componentsToResit: resitComponents,
          isUncapped: isResitUncapped
        },
        componentResults,
        auditLogs: moduleAudit
      },
      creditsEarned: 0,
      compensatedCredits: 0,
      failedCredits: module.credits,
      pendingResit: isResitEligible
    };
  }

  private validatePayloadIntegrity(payload: StudentPayload): void {
    this.validateStage(payload.stage);
    payload.modules.forEach(m => this.validateModule(m));
  }

  private validateStage(stage: number): void {
    if (typeof stage !== 'number' || stage < 1 || stage > 6) {
      throw new BadRequestException('Invalid academic stage provided.');
    }
  }

  private validateModule(m: CourseModule): void {
    if (!m.code || !m.credits || !m.components || !Array.isArray(m.components)) {
      throw new BadRequestException(`Malformed module structure for module code: ${m.code || 'UNKNOWN'}`);
    }
    m.components.forEach(c => this.validateComponent(c, m.code));
  }

  private validateComponent(c: AssessmentComponent, moduleCode: string): void {
    if (!c.attempts || !Array.isArray(c.attempts) || c.attempts.length === 0) {
      throw new UnprocessableEntityException(`Component ${c.id || c.name} in module ${moduleCode} must have at least one attempt record.`);
    }
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
        return 60.0; // No compensation allowed at Level 8
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

  private handleClearProgression(auditTrail: string[]) {
    auditTrail.push('All modules passed successfully. Clear progression guaranteed.');
    return { academicStanding: 'GOOD_STANDING' as const, canProgress: true, actionRequired: undefined };
  }

  private handlePendingResits(failedCredits: number, pendingResitsCount: number, auditTrail: string[]) {
    if (failedCredits > 60) {
      auditTrail.push(`Student failed ${failedCredits} credits, exceeding max allowable resit threshold.`);
      return {
        academicStanding: 'REQUIRED_TO_WITHDRAW' as const,
        canProgress: false,
        actionRequired: 'Failed too many credits (> 60). Discontinued from program.'
      };
    }
    auditTrail.push(`Student has ${pendingResitsCount} module(s) pending resits.`);
    return {
      academicStanding: 'PENDING_RESITS' as const,
      canProgress: false,
      actionRequired: 'Student must complete required resit assessments before progression decision.'
    };
  }

  private handleFailedCredits(failedCredits: number, stageAverage: number, auditTrail: string[]) {
    if (failedCredits <= 30 && stageAverage >= 50.0) {
      auditTrail.push('Progressed on probation under trailing credit rule.');
      return {
        academicStanding: 'PROBATION' as const,
        canProgress: true,
        actionRequired: 'Allowed to progress on academic probation with trailing credits.'
      };
    }
    if (failedCredits <= 40 && stageAverage >= 40.0) {
      auditTrail.push('Repeat year mandated due to uncompensated module failures.');
      return {
        academicStanding: 'ACADEMIC_WARNING' as const,
        canProgress: false,
        actionRequired: 'Must repeat failed modules in the upcoming academic year.'
      };
    }
    auditTrail.push(`Academic standing set to REQUIRED_TO_WITHDRAW due to ${failedCredits} failed credits.`);
    return {
      academicStanding: 'REQUIRED_TO_WITHDRAW' as const,
      canProgress: false,
      actionRequired: 'Excessive credit failure. Exited from program.'
    };
  }

  private evaluateAcademicStanding(
    failedCredits: number,
    pendingResitsCount: number,
    stageAverage: number,
    auditTrail: string[]
  ) {
    if (failedCredits === 0 && pendingResitsCount === 0) {
      return this.handleClearProgression(auditTrail);
    }
    if (pendingResitsCount > 0) {
      return this.handlePendingResits(failedCredits, pendingResitsCount, auditTrail);
    }
    if (failedCredits > 0) {
      return this.handleFailedCredits(failedCredits, stageAverage, auditTrail);
    }
    return { academicStanding: 'GOOD_STANDING' as const, canProgress: false, actionRequired: undefined };
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
    const totalCompensated = payload.cumulativeCompensatedCredits + compensatedCredits;
    const standing = this.evaluateAcademicStanding(failedCredits, pendingResitsCount, stageAverage, auditTrail);

    let projectedClassification: ProgressionDecision['projectedClassification'];
    if (payload.stage >= 3) {
      projectedClassification = this.calculateClassification(stageAverage, modules);
      auditTrail.push(`Projected Classification calculated as: ${projectedClassification}`);
    }

    return {
      academicStanding: standing.academicStanding,
      canProgressToNextStage: standing.canProgress,
      totalCreditsAttempted: totalAttempted,
      totalCreditsEarned: totalEarned,
      totalCompensatedCredits: totalCompensated,
      stageWeightedAverage: stageAverage,
      projectedClassification,
      actionRequired: standing.actionRequired,
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