import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';

export interface CollateralItem {
  id: string;
  type: 'REAL_ESTATE' | 'VEHICLE' | 'CRYPTO' | 'CASH' | 'EQUITY';
  estimatedValue: number;
  encumbranceAmount: number;
}

export interface DerogatoryMark {
  type: 'BANKRUPTCY' | 'FORECLOSURE' | '30_DAY_LATE' | '60_DAY_LATE' | '90_DAY_LATE';
  monthsAgo: number;
  amount?: number;
}

export interface CoSigner {
  creditScore: number;
  monthlyIncome: number;
  monthlyDebt: number;
  yearsEmployed: number;
}

export interface LoanApplicationRequest {
  applicantId: string;
  requestedAmount: number;
  termMonths: number;
  creditScore: number;
  monthlyIncome: number;
  monthlyDebt: number;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'SELF_EMPLOYED' | 'UNEMPLOYED';
  yearsEmployed: number;
  state: string;
  industrySector: string;
  collateral: CollateralItem[];
  derogatoryMarks: DerogatoryMark[];
  coSigner?: CoSigner;
  promotionalCode?: string;
}

export interface BatchApplicationRequest {
  batchId: string;
  applications: LoanApplicationRequest[];
}

export interface ReEvaluateRequest {
  updatedIncome?: number;
  updatedDebt?: number;
  updatedCreditScore?: number;
  additionalCollateral?: CollateralItem[];
}

export interface DynamicMatrixQuery {
  inflationRate: string;
  primeRate: string;
  marketStressIndex: string;
}

export interface OverrideRequest {
  executiveId: string;
  overrideCode: string;
  justification: string;
  maxApprovedAmount: number;
}

type Tier = 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';

interface TierInfo {
  tier: Tier;
  baseApr: number;
}

interface DerogatoryAnalysis {
  penalty: number;
  recentBankruptcy: boolean;
  severeBankruptcy: boolean;
  late90Count: number;
}

const HAIRCUTS: Record<CollateralItem['type'], number> = {
  CASH: 0.0,
  EQUITY: 0.15,
  REAL_ESTATE: 0.20,
  VEHICLE: 0.35,
  CRYPTO: 0.50,
};

const HIGH_RISK_STATES = new Set(['NV', 'FL', 'CA', 'NY']);

const DEROGATORY_STRATEGIES: Record<
  DerogatoryMark['type'],
  (mark: DerogatoryMark, acc: DerogatoryAnalysis) => void
> = {
  BANKRUPTCY: (mark, acc) => {
    if (mark.monthsAgo <= 24) {
      acc.recentBankruptcy = true;
    } else if (mark.monthsAgo <= 60) {
      acc.severeBankruptcy = true;
    }
  },
  FORECLOSURE: (mark, acc) => {
    acc.penalty += mark.monthsAgo <= 36 ? 40 : 20;
  },
  '90_DAY_LATE': (mark, acc) => {
    if (mark.monthsAgo <= 12) {
      acc.late90Count++;
      acc.penalty += 25;
    } else if (mark.monthsAgo <= 24) {
      acc.penalty += 10;
    }
  },
  '60_DAY_LATE': (mark, acc) => {
    if (mark.monthsAgo <= 12) {
      acc.penalty += 15;
    }
  },
  '30_DAY_LATE': (mark, acc) => {
    if (mark.monthsAgo <= 6) {
      acc.penalty += 5;
    }
  },
};

const DTI_DOWNGRADE_MAP: Record<Tier, TierInfo> = {
  TIER_A: { tier: 'TIER_B', baseApr: 7.5 },
  TIER_B: { tier: 'TIER_C', baseApr: 10.5 },
  TIER_C: { tier: 'TIER_D', baseApr: 15.0 },
  TIER_D: { tier: 'TIER_D', baseApr: 15.0 },
};

function validateLoanApplication(body: LoanApplicationRequest): void {
  if (!body || !body.requestedAmount || body.requestedAmount <= 0) {
    throw new BadRequestException('Requested loan amount must be positive');
  }
  if (body.creditScore < 300 || body.creditScore > 850) {
    throw new BadRequestException('Credit score must be between 300 and 850');
  }
}

function analyzeDerogatoryMarks(marks?: DerogatoryMark[]): DerogatoryAnalysis {
  const acc: DerogatoryAnalysis = {
    penalty: 0,
    recentBankruptcy: false,
    severeBankruptcy: false,
    late90Count: 0,
  };
  if (!marks || marks.length === 0) return acc;
  for (const mark of marks) {
    DEROGATORY_STRATEGIES[mark.type]?.(mark, acc);
  }
  return acc;
}

function checkEarlyDerogatoryRejection(derogatory: DerogatoryAnalysis): string | null {
  if (derogatory.recentBankruptcy) return 'Bankruptcy within 24 months';
  if (derogatory.late90Count >= 3) return 'Excessive recent 90-day late payments';
  return null;
}

function createRejectionResponse(reason: string) {
  return {
    decision: 'REJECTED',
    tier: 'REJECTED',
    approvedAmount: 0,
    apr: 0,
    rejectionReasons: [reason],
  };
}

function calculateEmploymentIncome(employmentType: string, yearsEmployed: number, income: number): number {
  if (employmentType === 'SELF_EMPLOYED') {
    if (yearsEmployed < 2) return income * 0.75;
    if (yearsEmployed < 5) return income * 0.90;
    return income;
  }
  if (employmentType === 'UNEMPLOYED') {
    return income * 0.20;
  }
  return income;
}

function applyCoSigner(
  creditScore: number,
  monthlyIncome: number,
  monthlyDebt: number,
  coSigner?: CoSigner
): { effectiveCreditScore: number; baseMonthlyIncome: number; baseMonthlyDebt: number } {
  let effectiveCreditScore = creditScore;
  let baseMonthlyIncome = monthlyIncome;
  let baseMonthlyDebt = monthlyDebt;

  if (coSigner) {
    if (coSigner.creditScore >= 720) {
      effectiveCreditScore = Math.min(850, Math.round((creditScore + coSigner.creditScore) / 2) + 15);
    }
    baseMonthlyIncome += coSigner.monthlyIncome;
    baseMonthlyDebt += coSigner.monthlyDebt;
  }

  return { effectiveCreditScore, baseMonthlyIncome, baseMonthlyDebt };
}

function calculateAdjustedCollateral(collateral?: CollateralItem[]): number {
  if (!collateral || collateral.length === 0) return 0;

  let totalAdjustedCollateral = 0;
  let cryptoValue = 0;
  let totalRawCollateral = 0;

  for (const item of collateral) {
    const netVal = Math.max(0, item.estimatedValue - item.encumbranceAmount);
    totalRawCollateral += netVal;

    const haircut = HAIRCUTS[item.type] ?? 0.10;
    if (item.type === 'CRYPTO') {
      cryptoValue += netVal;
    }

    totalAdjustedCollateral += netVal * (1 - haircut);
  }

  if (totalRawCollateral > 0 && cryptoValue / totalRawCollateral > 0.5) {
    totalAdjustedCollateral *= 0.85;
  }

  return totalAdjustedCollateral;
}

function checkLowScoreRejection(
  creditScore: number,
  collateral: number,
  requestedAmount: number,
  coSigner?: CoSigner
): boolean {
  if (creditScore >= 580) return false;
  const covers150Percent = collateral >= requestedAmount * 1.5;
  const possessesEliteCoSigner = Boolean(coSigner && coSigner.creditScore >= 780);
  return !covers150Percent && !possessesEliteCoSigner;
}

function getBaseTierInfo(creditScore: number): TierInfo {
  if (creditScore >= 800) return { tier: 'TIER_A', baseApr: 5.5 };
  if (creditScore >= 740) return { tier: 'TIER_B', baseApr: 7.5 };
  if (creditScore >= 670) return { tier: 'TIER_C', baseApr: 10.5 };
  return { tier: 'TIER_D', baseApr: 15.0 };
}

function determineTierAndBaseApr(
  creditScore: number,
  severeBankruptcy: boolean,
  dti: number
): TierInfo {
  let tierInfo = getBaseTierInfo(creditScore);

  if (severeBankruptcy && tierInfo.tier !== 'TIER_D') {
    tierInfo = { tier: 'TIER_D', baseApr: 15.0 };
  }

  if (dti > 43 && dti <= 55) {
    tierInfo = DTI_DOWNGRADE_MAP[tierInfo.tier];
  }

  return tierInfo;
}

function getLtvAdjustmentResult(
  ltv: number,
  creditScore: number,
  dti: number
): { adjustment: number; rejectionReason?: string } {
  if (ltv <= 80) {
    return { adjustment: -0.5 };
  }
  if (ltv > 100 && ltv <= 120) {
    return { adjustment: 1.5 };
  }
  if (ltv > 120) {
    if (creditScore < 720 || dti > 35) {
      return {
        adjustment: 0,
        rejectionReason: 'Unsecured LTV > 120% requires minimum credit score 720 and maximum DTI 35%',
      };
    }
    return { adjustment: 3.0 };
  }
  return { adjustment: 0 };
}

function calculateAprAdjustment(
  ltvAdjustment: number,
  yearsEmployed: number,
  state: string,
  dti: number,
  promotionalCode?: string
): number {
  let adjustment = ltvAdjustment;

  if (yearsEmployed < 1) {
    adjustment += 1.25;
  }

  const normalizedState = state ? state.toUpperCase() : '';
  if (HIGH_RISK_STATES.has(normalizedState) && dti > 40) {
    adjustment += 0.75;
  }

  if (promotionalCode === 'SUPERPROMO2025') {
    adjustment -= 1.0;
  }

  return adjustment;
}

function calculateApprovedAmount(
  requestedAmount: number,
  severeBankruptcy: boolean,
  tier: Tier
): number {
  let approvedAmount = requestedAmount;

  if (severeBankruptcy) {
    approvedAmount = Math.min(approvedAmount, 25000);
  }
  if (tier === 'TIER_D' && requestedAmount > 50000) {
    approvedAmount = 50000;
  }

  return approvedAmount;
}

@Controller('loan-applications')
export class LoanApprovalController {

  @Post('evaluate')
  evaluateLoan(@Body() body: LoanApplicationRequest) {
    validateLoanApplication(body);

    const derogatory = analyzeDerogatoryMarks(body.derogatoryMarks);
    const earlyRejectionReason = checkEarlyDerogatoryRejection(derogatory);
    if (earlyRejectionReason) {
      return createRejectionResponse(earlyRejectionReason);
    }

    const initialScore = Math.max(300, body.creditScore - derogatory.penalty);
    const adjustedIncome = calculateEmploymentIncome(body.employmentType, body.yearsEmployed, body.monthlyIncome);
    const { effectiveCreditScore, baseMonthlyIncome, baseMonthlyDebt } = applyCoSigner(
      initialScore,
      adjustedIncome,
      body.monthlyDebt,
      body.coSigner
    );

    const dti = baseMonthlyIncome > 0 ? (baseMonthlyDebt / baseMonthlyIncome) * 100 : 999;
    if (dti > 55) {
      return createRejectionResponse(`Debt-to-Income ratio (${dti.toFixed(2)}%) exceeds maximum threshold of 55%`);
    }

    const totalAdjustedCollateral = calculateAdjustedCollateral(body.collateral);
    const ltv = totalAdjustedCollateral > 0 ? (body.requestedAmount / totalAdjustedCollateral) * 100 : 999;

    if (checkLowScoreRejection(effectiveCreditScore, totalAdjustedCollateral, body.requestedAmount, body.coSigner)) {
      return createRejectionResponse('Credit score below 580 without sufficient collateral (150%) or elite co-signer');
    }

    const tierInfo = determineTierAndBaseApr(effectiveCreditScore, derogatory.severeBankruptcy, dti);
    const ltvResult = getLtvAdjustmentResult(ltv, effectiveCreditScore, dti);
    if (ltvResult.rejectionReason) {
      return createRejectionResponse(ltvResult.rejectionReason);
    }

    const aprAdjustment = calculateAprAdjustment(
      ltvResult.adjustment,
      body.yearsEmployed,
      body.state,
      dti,
      body.promotionalCode
    );

    const finalApr = Math.max(3.5, tierInfo.baseApr + aprAdjustment);
    const approvedAmount = calculateApprovedAmount(body.requestedAmount, derogatory.severeBankruptcy, tierInfo.tier);

    return {
      decision: approvedAmount === body.requestedAmount ? 'APPROVED' : 'CONDITIONALLY_APPROVED',
      tier: tierInfo.tier,
      approvedAmount: approvedAmount,
      requestedAmount: body.requestedAmount,
      apr: Number(finalApr.toFixed(2)),
      effectiveCreditScore: effectiveCreditScore,
      calculatedDti: Number(dti.toFixed(2)),
      calculatedLtv: ltv === 999 ? 'UNSECURED' : Number(ltv.toFixed(2)),
      rejectionReasons: [],
    };
  }

  @Post('batch-evaluate')
  evaluateBatch(@Body() body: BatchApplicationRequest) {
    if (!body || !body.applications || !Array.isArray(body.applications)) {
      throw new BadRequestException('Batch must contain an array of applications');
    }

    const results: Array<Record<string, any>> = [];
    const sectorExposure: Record<string, number> = {};

    for (let i = 0; i < body.applications.length; i++) {
      const app = body.applications[i];
      const sector = app.industrySector || 'UNKNOWN';
      const currentSectorTotal = sectorExposure[sector] || 0;

      const evalResult = this.evaluateLoan(app);

      if (evalResult.decision === 'APPROVED' || evalResult.decision === 'CONDITIONALLY_APPROVED') {
        let finalApr = evalResult.apr;
        if (currentSectorTotal > 1000000) {
          finalApr += 1.5;
        }

        sectorExposure[sector] = currentSectorTotal + evalResult.approvedAmount;

        results.push({
          applicantId: app.applicantId,
          status: evalResult.decision,
          tier: evalResult.tier,
          approvedAmount: evalResult.approvedAmount,
          apr: Number(finalApr.toFixed(2)),
          sectorConcentrationWarning: currentSectorTotal > 1000000,
        });
      } else {
        results.push({
          applicantId: app.applicantId,
          status: evalResult.decision,
          tier: evalResult.tier,
          approvedAmount: 0,
          apr: 0,
          rejectionReasons: evalResult.rejectionReasons,
        });
      }
    }

    return {
      batchId: body.batchId,
      totalProcessed: body.applications.length,
      sectorExposureSummary: sectorExposure,
      results: results,
    };
  }

  @Put(':id/re-evaluate')
  reEvaluateLoan(
    @Param('id') id: string,
    @Body() body: LoanApplicationRequest & ReEvaluateRequest,
  ) {
    if (!id) {
      throw new BadRequestException('Application ID is required');
    }

    const mergedIncome = body.updatedIncome !== undefined ? body.updatedIncome : body.monthlyIncome;
    const mergedDebt = body.updatedDebt !== undefined ? body.updatedDebt : body.monthlyDebt;
    const mergedScore = body.updatedCreditScore !== undefined ? body.updatedCreditScore : body.creditScore;

    let mergedCollateral = [...(body.collateral || [])];
    if (body.additionalCollateral && Array.isArray(body.additionalCollateral)) {
      mergedCollateral = mergedCollateral.concat(body.additionalCollateral);
    }

    const updatedApp: LoanApplicationRequest = {
      ...body,
      monthlyIncome: mergedIncome,
      monthlyDebt: mergedDebt,
      creditScore: mergedScore,
      collateral: mergedCollateral,
    };

    const reEvalResult = this.evaluateLoan(updatedApp);

    return {
      applicationId: id,
      reEvaluationTimestamp: new Date().toISOString(),
      updatedMetrics: {
        income: mergedIncome,
        debt: mergedDebt,
        creditScore: mergedScore,
        totalCollateralItems: mergedCollateral.length,
      },
      evaluation: reEvalResult,
    };
  }

  @Get('risk-matrix')
  getRiskMatrix(@Query() query: DynamicMatrixQuery) {
    const inflation = parseFloat(query.inflationRate || '3.0');
    const prime = parseFloat(query.primeRate || '8.5');
    const stressIndex = parseFloat(query.marketStressIndex || '1.0');

    if (isNaN(inflation) || isNaN(prime) || isNaN(stressIndex)) {
      throw new BadRequestException('Invalid query parameters for risk matrix recalculation');
    }

    const baseAprs = {
      TIER_A: prime + 0.5,
      TIER_B: prime + 2.5,
      TIER_C: prime + 5.5,
      TIER_D: prime + 10.0,
    };

    let stressMultiplier = 1.0;
    if (stressIndex > 2.5) {
      stressMultiplier = 1.25;
    } else if (stressIndex > 1.5) {
      stressMultiplier = 1.10;
    }

    const adjustedMatrix = {
      inflationRate: inflation,
      primeRate: prime,
      stressIndex: stressIndex,
      tierThresholds: [
        { tier: 'TIER_A', minScore: 800, maxDti: 45, baseApr: Number((baseAprs.TIER_A * stressMultiplier).toFixed(2)) },
        { tier: 'TIER_B', minScore: 740, maxDti: 43, baseApr: Number((baseAprs.TIER_B * stressMultiplier).toFixed(2)) },
        { tier: 'TIER_C', minScore: 670, maxDti: 40, baseApr: Number((baseAprs.TIER_C * stressMultiplier).toFixed(2)) },
        { tier: 'TIER_D', minScore: 580, maxDti: 35, baseApr: Number((baseAprs.TIER_D * stressMultiplier).toFixed(2)) },
      ],
    };

    return adjustedMatrix;
  }

  @Delete(':id/override')
  overrideRejection(
    @Param('id') id: string,
    @Body() body: OverrideRequest,
  ) {
    if (!id) {
      throw new BadRequestException('Application ID is required');
    }
    if (!body || !body.executiveId || !body.overrideCode || !body.justification) {
      throw new BadRequestException('Executive ID, override code, and justification are mandatory');
    }

    if (body.overrideCode !== 'EXEC_OVERRIDE_LEVEL_3') {
      throw new HttpException('Unauthorized override code', HttpStatus.FORBIDDEN);
    }

    if (body.justification.length < 20) {
      throw new BadRequestException('Detailed justification (min 20 chars) is required for supervisory overrides');
    }

    const penaltyApr = 18.5;
    const cappedAmount = Math.min(body.maxApprovedAmount || 10000, 25000);

    return {
      applicationId: id,
      overrideStatus: 'EXECUTED',
      approvedBy: body.executiveId,
      timestamp: new Date().toISOString(),
      terms: {
        tier: 'OVERRIDE_TIER',
        approvedAmount: cappedAmount,
        apr: penaltyApr,
        mandatoryCollateralCheckRequired: true,
        quarterlyAuditFlagged: true,
      },
    };
  }
}