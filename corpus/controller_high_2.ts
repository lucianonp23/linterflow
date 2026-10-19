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

@Controller('loan-applications')
export class LoanApprovalController {

  @Post('evaluate')
  evaluateLoan(@Body() body: LoanApplicationRequest) {
    if (!body || !body.requestedAmount || body.requestedAmount <= 0) {
      throw new BadRequestException('Requested loan amount must be positive');
    }
    if (body.creditScore < 300 || body.creditScore > 850) {
      throw new BadRequestException('Credit score must be between 300 and 850');
    }

    let effectiveCreditScore = body.creditScore;
    let baseMonthlyIncome = body.monthlyIncome;
    let baseMonthlyDebt = body.monthlyDebt;
    let totalDerogatoryPenalty = 0;
    let recentBankruptcy = false;
    let severeBankruptcy = false;
    let late90Count = 0;

    if (body.derogatoryMarks && body.derogatoryMarks.length > 0) {
      for (let i = 0; i < body.derogatoryMarks.length; i++) {
        const mark = body.derogatoryMarks[i];
        switch (mark.type) {
          case 'BANKRUPTCY':
            if (mark.monthsAgo <= 24) {
              recentBankruptcy = true;
            } else if (mark.monthsAgo <= 60) {
              severeBankruptcy = true;
            }
            break;
          case 'FORECLOSURE':
            if (mark.monthsAgo <= 36) {
              totalDerogatoryPenalty += 40;
            } else {
              totalDerogatoryPenalty += 20;
            }
            break;
          case '90_DAY_LATE':
            if (mark.monthsAgo <= 12) {
              late90Count++;
              totalDerogatoryPenalty += 25;
            } else if (mark.monthsAgo <= 24) {
              totalDerogatoryPenalty += 10;
            }
            break;
          case '60_DAY_LATE':
            if (mark.monthsAgo <= 12) {
              totalDerogatoryPenalty += 15;
            }
            break;
          case '30_DAY_LATE':
            if (mark.monthsAgo <= 6) {
              totalDerogatoryPenalty += 5;
            }
            break;
        }
      }
    }

    if (recentBankruptcy || late90Count >= 3) {
      return {
        decision: 'REJECTED',
        tier: 'REJECTED',
        approvedAmount: 0,
        apr: 0,
        rejectionReasons: [
          recentBankruptcy ? 'Bankruptcy within 24 months' : 'Excessive recent 90-day late payments',
        ],
      };
    }

    effectiveCreditScore = Math.max(300, effectiveCreditScore - totalDerogatoryPenalty);

    if (body.employmentType === 'SELF_EMPLOYED') {
      if (body.yearsEmployed < 2) {
        baseMonthlyIncome = baseMonthlyIncome * 0.75;
      } else if (body.yearsEmployed < 5) {
        baseMonthlyIncome = baseMonthlyIncome * 0.90;
      }
    } else if (body.employmentType === 'UNEMPLOYED') {
      baseMonthlyIncome = baseMonthlyIncome * 0.20;
    }

    if (body.coSigner) {
      if (body.coSigner.creditScore >= 720) {
        effectiveCreditScore = Math.min(850, Math.round((effectiveCreditScore + body.coSigner.creditScore) / 2) + 15);
      }
      baseMonthlyIncome += body.coSigner.monthlyIncome;
      baseMonthlyDebt += body.coSigner.monthlyDebt;
    }

    const dti = baseMonthlyIncome > 0 ? (baseMonthlyDebt / baseMonthlyIncome) * 100 : 999;

    if (dti > 55) {
      return {
        decision: 'REJECTED',
        tier: 'REJECTED',
        approvedAmount: 0,
        apr: 0,
        rejectionReasons: [`Debt-to-Income ratio (${dti.toFixed(2)}%) exceeds maximum threshold of 55%`],
      };
    }

    let totalAdjustedCollateral = 0;
    let cryptoValue = 0;
    let totalRawCollateral = 0;

    if (body.collateral && body.collateral.length > 0) {
      for (let j = 0; j < body.collateral.length; j++) {
        const item = body.collateral[j];
        const netVal = Math.max(0, item.estimatedValue - item.encumbranceAmount);
        totalRawCollateral += netVal;

        let haircut = 0.10;
        switch (item.type) {
          case 'CASH':
            haircut = 0.0;
            break;
          case 'EQUITY':
            haircut = 0.15;
            break;
          case 'REAL_ESTATE':
            haircut = 0.20;
            break;
          case 'VEHICLE':
            haircut = 0.35;
            break;
          case 'CRYPTO':
            haircut = 0.50;
            cryptoValue += netVal;
            break;
        }
        totalAdjustedCollateral += netVal * (1 - haircut);
      }

      if (totalRawCollateral > 0 && cryptoValue / totalRawCollateral > 0.5) {
        totalAdjustedCollateral = totalAdjustedCollateral * 0.85;
      }
    }

    const ltv = totalAdjustedCollateral > 0 ? (body.requestedAmount / totalAdjustedCollateral) * 100 : 999;

    if (effectiveCreditScore < 580) {
      const covers150Percent = totalAdjustedCollateral >= body.requestedAmount * 1.5;
      const possessesEliteCoSigner = body.coSigner && body.coSigner.creditScore >= 780;

      if (!covers150Percent && !possessesEliteCoSigner) {
        return {
          decision: 'REJECTED',
          tier: 'REJECTED',
          approvedAmount: 0,
          apr: 0,
          rejectionReasons: ['Credit score below 580 without sufficient collateral (150%) or elite co-signer'],
        };
      }
    }

    let tier: 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D' = 'TIER_D';
    let baseApr = 15.0;

    if (effectiveCreditScore >= 800) {
      tier = 'TIER_A';
      baseApr = 5.5;
    } else if (effectiveCreditScore >= 740) {
      tier = 'TIER_B';
      baseApr = 7.5;
    } else if (effectiveCreditScore >= 670) {
      tier = 'TIER_C';
      baseApr = 10.5;
    } else {
      tier = 'TIER_D';
      baseApr = 15.0;
    }

    if (severeBankruptcy && (tier === 'TIER_A' || tier === 'TIER_B' || tier === 'TIER_C')) {
      tier = 'TIER_D';
      baseApr = 15.0;
    }

    if (dti > 43 && dti <= 55) {
      if (tier === 'TIER_A') { tier = 'TIER_B'; baseApr = 7.5; }
      else if (tier === 'TIER_B') { tier = 'TIER_C'; baseApr = 10.5; }
      else if (tier === 'TIER_C') { tier = 'TIER_D'; baseApr = 15.0; }
    }

    let aprAdjustment = 0;

    if (ltv <= 80) {
      aprAdjustment -= 0.5;
    } else if (ltv > 100 && ltv <= 120) {
      aprAdjustment += 1.5;
    } else if (ltv > 120) {
      if (effectiveCreditScore < 720 || dti > 35) {
        return {
          decision: 'REJECTED',
          tier: 'REJECTED',
          approvedAmount: 0,
          apr: 0,
          rejectionReasons: ['Unsecured LTV > 120% requires minimum credit score 720 and maximum DTI 35%'],
        };
      }
      aprAdjustment += 3.0;
    }

    if (body.yearsEmployed < 1) {
      aprAdjustment += 1.25;
    }

    if (['NV', 'FL', 'CA', 'NY'].includes(body.state ? body.state.toUpperCase() : '') && dti > 40) {
      aprAdjustment += 0.75;
    }

    if (body.promotionalCode === 'SUPERPROMO2025') {
      aprAdjustment -= 1.0;
    }

    const finalApr = Math.max(3.5, baseApr + aprAdjustment);
    let approvedAmount = body.requestedAmount;

    if (severeBankruptcy) {
      approvedAmount = Math.min(approvedAmount, 25000);
    }
    if (tier === 'TIER_D' && body.requestedAmount > 50000) {
      approvedAmount = 50000;
    }

    return {
      decision: approvedAmount === body.requestedAmount ? 'APPROVED' : 'CONDITIONALLY_APPROVED',
      tier: tier,
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
