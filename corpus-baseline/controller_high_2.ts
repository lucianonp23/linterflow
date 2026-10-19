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

type LoanTier = 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';

const HAIRCUT_RATES: Record<string, number> = {
  CASH: 0.0,
  EQUITY: 0.15,
  REAL_ESTATE: 0.20,
  VEHICLE: 0.35,
  CRYPTO: 0.50,
};

const HIGH_RISK_STATES = new Set(['NV', 'FL', 'CA', 'NY']);
const EXEC_OVERRIDE_CODE = 'EXEC_OVERRIDE_LEVEL_3';

@Controller('loan-applications')
export class LoanApprovalController {

  @Post('evaluate')
  evaluateLoan(@Body() body: LoanApplicationRequest) {
    this.validateLoanRequest(body);

    const markAnalysis = this.analyzeDerogatoryMarks(body.derogatoryMarks || []);
    if (markAnalysis.recentBankruptcy || markAnalysis.late90Count >= 3) {
      const reason = markAnalysis.recentBankruptcy
        ? 'Bankruptcy within 24 months'
        : 'Excessive recent 90-day late payments';
      return this.rejectApplication(reason);
    }

    let effectiveCreditScore = Math.max(300, body.creditScore - markAnalysis.totalPenalty);
    let baseMonthlyIncome = this.adjustIncomeForEmployment(body.employmentType, body.yearsEmployed, body.monthlyIncome);
    let baseMonthlyDebt = body.monthlyDebt;

    if (body.coSigner) {
      if (body.coSigner.creditScore >= 720) {
        effectiveCreditScore = Math.min(
          850,
          Math.round((effectiveCreditScore + body.coSigner.creditScore) / 2) + 15,
        );
      }
      baseMonthlyIncome += body.coSigner.monthlyIncome;
      baseMonthlyDebt += body.coSigner.monthlyDebt;
    }

    const dti = baseMonthlyIncome > 0 ? (baseMonthlyDebt / baseMonthlyIncome) * 100 : 999;
    if (dti > 55) {
      return this.rejectApplication(`Debt-to-Income ratio (${dti.toFixed(2)}%) exceeds maximum threshold of 55%`);
    }

    const collateralSummary = this.calculateCollateralSummary(body.collateral || []);
    const totalAdjustedCollateral = collateralSummary.adjustedCollateral;
    const ltv = totalAdjustedCollateral > 0 ? (body.requestedAmount / totalAdjustedCollateral) * 100 : 999;

    if (effectiveCreditScore < 580) {
      const covers150Percent = totalAdjustedCollateral >= body.requestedAmount * 1.5;
      const possessesEliteCoSigner = body.coSigner ? body.coSigner.creditScore >= 780 : false;

      if (!covers150Percent && !possessesEliteCoSigner) {
        return this.rejectApplication(
          'Credit score below 580 without sufficient collateral (150%) or elite co-signer',
        );
      }
    }

    let { tier, baseApr } = this.determineTierAndBaseApr(effectiveCreditScore, markAnalysis.severeBankruptcy, dti);

    let aprAdjustment = 0;
    if (ltv <= 80) {
      aprAdjustment -= 0.5;
    } else if (ltv > 100 && ltv <= 120) {
      aprAdjustment += 1.5;
    } else if (ltv > 120) {
      if (effectiveCreditScore < 720 || dti > 35) {
        return this.rejectApplication(
          'Unsecured LTV > 120% requires minimum credit score 720 and maximum DTI 35%',
        );
      }
      aprAdjustment += 3.0;
    }

    if (body.yearsEmployed < 1) {
      aprAdjustment += 1.25;
    }

    const normalizedState = body.state ? body.state.toUpperCase() : '';
    if (HIGH_RISK_STATES.has(normalizedState) && dti > 40) {
      aprAdjustment += 0.75;
    }

    if (body.promotionalCode === 'SUPERPROMO2025') {
      aprAdjustment -= 1.0;
    }

    const finalApr = Math.max(3.5, baseApr + aprAdjustment);
    let approvedAmount = body.requestedAmount;

    if (markAnalysis.severeBankruptcy) {
      approvedAmount = Math.min(approvedAmount, 25000);
    }
    if (tier === 'TIER_D' && body.requestedAmount > 50000) {
      approvedAmount = 50000;
    }

    return {
      decision: approvedAmount === body.requestedAmount ? 'APPROVED' : 'CONDITIONALLY_APPROVED',
      tier,
      approvedAmount,
      requestedAmount: body.requestedAmount,
      apr: Number(finalApr.toFixed(2)),
      effectiveCreditScore,
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

    for (const app of body.applications) {
      const sector = app.industrySector || 'UNKNOWN';
      const currentSectorTotal = sectorExposure[sector] || 0;

      const evalResult = this.evaluateLoan(app);

      if (evalResult.decision === 'APPROVED' || evalResult.decision === 'CONDITIONALLY_APPROVED') {
        let finalApr = evalResult.apr;
        const warning = currentSectorTotal > 1000000;
        if (warning) {
          finalApr += 1.5;
        }

        sectorExposure[sector] = currentSectorTotal + evalResult.approvedAmount;

        results.push({
          applicantId: app.applicantId,
          status: evalResult.decision,
          tier: evalResult.tier,
          approvedAmount: evalResult.approvedAmount,
          apr: Number(finalApr.toFixed(2)),
          sectorConcentrationWarning: warning,
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
      results,
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

    return {
      inflationRate: inflation,
      primeRate: prime,
      stressIndex,
      tierThresholds: [
        { tier: 'TIER_A', minScore: 800, maxDti: 45, baseApr: Number((baseAprs.TIER_A * stressMultiplier).toFixed(2)) },
        { tier: 'TIER_B', minScore: 740, maxDti: 43, baseApr: Number((baseAprs.TIER_B * stressMultiplier).toFixed(2)) },
        { tier: 'TIER_C', minScore: 670, maxDti: 40, baseApr: Number((baseAprs.TIER_C * stressMultiplier).toFixed(2)) },
        { tier: 'TIER_D', minScore: 580, maxDti: 35, baseApr: Number((baseAprs.TIER_D * stressMultiplier).toFixed(2)) },
      ],
    };
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

    if (body.overrideCode !== EXEC_OVERRIDE_CODE) {
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

  private validateLoanRequest(body: LoanApplicationRequest): void {
    if (!body || !body.requestedAmount || body.requestedAmount <= 0) {
      throw new BadRequestException('Requested loan amount must be positive');
    }
    if (body.creditScore < 300 || body.creditScore > 850) {
      throw new BadRequestException('Credit score must be between 300 and 850');
    }
  }

  private rejectApplication(reason: string) {
    return {
      decision: 'REJECTED',
      tier: 'REJECTED',
      approvedAmount: 0,
      apr: 0,
      rejectionReasons: [reason],
    };
  }

  private analyzeDerogatoryMarks(marks: DerogatoryMark[]) {
    let totalPenalty = 0;
    let recentBankruptcy = false;
    let severeBankruptcy = false;
    let late90Count = 0;

    for (const mark of marks) {
      switch (mark.type) {
        case 'BANKRUPTCY':
          if (mark.monthsAgo <= 24) {
            recentBankruptcy = true;
          } else if (mark.monthsAgo <= 60) {
            severeBankruptcy = true;
          }
          break;
        case 'FORECLOSURE':
          totalPenalty += mark.monthsAgo <= 36 ? 40 : 20;
          break;
        case '90_DAY_LATE':
          if (mark.monthsAgo <= 12) {
            late90Count++;
            totalPenalty += 25;
          } else if (mark.monthsAgo <= 24) {
            totalPenalty += 10;
          }
          break;
        case '60_DAY_LATE':
          if (mark.monthsAgo <= 12) {
            totalPenalty += 15;
          }
          break;
        case '30_DAY_LATE':
          if (mark.monthsAgo <= 6) {
            totalPenalty += 5;
          }
          break;
      }
    }

    return { totalPenalty, recentBankruptcy, severeBankruptcy, late90Count };
  }

  private adjustIncomeForEmployment(
    type: LoanApplicationRequest['employmentType'],
    yearsEmployed: number,
    monthlyIncome: number,
  ): number {
    if (type === 'SELF_EMPLOYED') {
      if (yearsEmployed < 2) return monthlyIncome * 0.75;
      if (yearsEmployed < 5) return monthlyIncome * 0.90;
    } else if (type === 'UNEMPLOYED') {
      return monthlyIncome * 0.20;
    }
    return monthlyIncome;
  }

  private calculateCollateralSummary(collateral: CollateralItem[]) {
    let totalAdjustedCollateral = 0;
    let cryptoValue = 0;
    let totalRawCollateral = 0;

    for (const item of collateral) {
      const netVal = Math.max(0, item.estimatedValue - item.encumbranceAmount);
      totalRawCollateral += netVal;

      const haircut = HAIRCUT_RATES[item.type] ?? 0.10;
      if (item.type === 'CRYPTO') {
        cryptoValue += netVal;
      }
      totalAdjustedCollateral += netVal * (1 - haircut);
    }

    if (totalRawCollateral > 0 && cryptoValue / totalRawCollateral > 0.5) {
      totalAdjustedCollateral *= 0.85;
    }

    return {
      adjustedCollateral: totalAdjustedCollateral,
      rawCollateral: totalRawCollateral,
    };
  }

  private determineTierAndBaseApr(
    creditScore: number,
    severeBankruptcy: boolean,
    dti: number,
  ): { tier: LoanTier; baseApr: number } {
    let tier: LoanTier = 'TIER_D';
    let baseApr = 15.0;

    if (creditScore >= 800) {
      tier = 'TIER_A';
      baseApr = 5.5;
    } else if (creditScore >= 740) {
      tier = 'TIER_B';
      baseApr = 7.5;
    } else if (creditScore >= 670) {
      tier = 'TIER_C';
      baseApr = 10.5;
    }

    if (severeBankruptcy && tier !== 'TIER_D') {
      tier = 'TIER_D';
      baseApr = 15.0;
    }

    if (dti > 43 && dti <= 55) {
      if (tier === 'TIER_A') {
        tier = 'TIER_B';
        baseApr = 7.5;
      } else if (tier === 'TIER_B') {
        tier = 'TIER_C';
        baseApr = 10.5;
      } else if (tier === 'TIER_C') {
        tier = 'TIER_D';
        baseApr = 15.0;
      }
    }

    return { tier, baseApr };
  }
}