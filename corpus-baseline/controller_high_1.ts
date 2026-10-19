import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

export type ClaimType = 'HEALTH' | 'AUTO' | 'HOME' | 'TRAVEL' | 'LIFE';
export type CustomerTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND';
export type FraudFlag =
  | 'SUSPICIOUS_LOCATION'
  | 'DUPLICATE_RECEIPT'
  | 'HIGH_FREQUENCY_CLAIMS'
  | 'RECENT_POLICY_CHANGE'
  | 'UNLICENSED_PROVIDER'
  | 'BLACK_LISTED_IP';
export type ClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'MANUAL_AUDIT_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'CANCELLED';

export interface LineItem {
  id: string;
  description: string;
  amount: number;
  category: string;
  flagged: boolean;
}

export interface Claim {
  id: string;
  policyNumber: string;
  customerId: string;
  customerTier: CustomerTier;
  claimType: ClaimType;
  amount: number;
  dateOfIncident: string;
  filingDate: string;
  description: string;
  lineItems: LineItem[];
  fraudFlags: FraudFlag[];
  status: ClaimStatus;
  approvedAmount: number;
  deductible: number;
  fraudScore: number;
  auditTrail: string[];
}

export interface CreateClaimDto {
  policyNumber: string;
  customerId: string;
  customerTier: CustomerTier;
  claimType: ClaimType;
  amount: number;
  dateOfIncident: string;
  filingDate: string;
  description: string;
  lineItems: Array<{
    id: string;
    description: string;
    amount: number;
    category: string;
  }>;
  fraudFlags?: FraudFlag[];
}

export interface EvaluateClaimDto {
  updatedLineItems?: Array<{
    id: string;
    description: string;
    amount: number;
    category: string;
    flagged?: boolean;
  }>;
  additionalFraudFlags?: FraudFlag[];
  forceReevaluation?: boolean;
}

export interface ManualReviewDto {
  adjusterId: string;
  adjusterLevel: 1 | 2 | 3 | 4;
  decision: 'APPROVE' | 'REJECT' | 'ESCALATE';
  overrideAmount?: number;
  reason: string;
  mitigationNotes?: string[];
}

const MS_PER_DAY = 1000 * 3600 * 24;

const COVERAGE_LIMITS: Record<ClaimType, Record<CustomerTier, number>> = {
  HEALTH: { BRONZE: 5000, SILVER: 15000, GOLD: 50000, PLATINUM: 200000, DIAMOND: 1000000 },
  AUTO: { BRONZE: 10000, SILVER: 25000, GOLD: 75000, PLATINUM: 150000, DIAMOND: 500000 },
  HOME: { BRONZE: 20000, SILVER: 50000, GOLD: 200000, PLATINUM: 500000, DIAMOND: 2000000 },
  TRAVEL: { BRONZE: 2000, SILVER: 5000, GOLD: 15000, PLATINUM: 50000, DIAMOND: 100000 },
  LIFE: { BRONZE: 50000, SILVER: 100000, GOLD: 500000, PLATINUM: 1000000, DIAMOND: 5000000 },
};

const FLAG_SCORES: Record<FraudFlag, number> = {
  BLACK_LISTED_IP: 50,
  UNLICENSED_PROVIDER: 40,
  DUPLICATE_RECEIPT: 30,
  HIGH_FREQUENCY_CLAIMS: 25,
  RECENT_POLICY_CHANGE: 20,
  SUSPICIOUS_LOCATION: 15,
};

const ADJUSTER_APPROVAL_LIMITS: Record<number, number> = {
  1: 5000,
  2: 25000,
  3: 100000,
  4: Number.MAX_SAFE_INTEGER,
};

function calculateDeductible(tier: CustomerTier, amount: number): number {
  switch (tier) {
    case 'BRONZE':
      return Math.max(500, amount * 0.20);
    case 'SILVER':
      return Math.max(300, amount * 0.15);
    case 'GOLD':
      return Math.max(100, amount * 0.10);
    case 'PLATINUM':
      return amount * 0.05;
    case 'DIAMOND':
      return 0;
    default:
      throw new BadRequestException('Invalid customer tier.');
  }
}

function getCoverageLimit(claimType: ClaimType, customerTier: CustomerTier): number {
  const typeLimits = COVERAGE_LIMITS[claimType];
  if (!typeLimits) {
    throw new BadRequestException('Invalid claim type.');
  }
  const limit = typeLimits[customerTier];
  if (limit === undefined) {
    throw new BadRequestException('Invalid customer tier.');
  }
  return limit;
}

function getDaysBetween(newer: Date, older: Date): number {
  return (newer.getTime() - older.getTime()) / MS_PER_DAY;
}

function calculateFlagScoreSum(flags: FraudFlag[]): number {
  return flags.reduce((sum, flag) => sum + (FLAG_SCORES[flag] ?? 0), 0);
}

@Controller('insurance-claims')
export class InsuranceClaimsController {
  private claimsDb: Map<string, Claim> = new Map();

  @Post()
  public createAndEvaluateClaim(@Body() dto: CreateClaimDto): Claim {
    this.validateCreateClaimDto(dto);

    const incidentDate = new Date(dto.dateOfIncident);
    const filingDate = new Date(dto.filingDate);
    const now = new Date();

    this.validateDates(incidentDate, filingDate, now);

    const processedLineItems = this.processInitialLineItems(dto.lineItems, dto.amount);
    const calculatedDeductible = calculateDeductible(dto.customerTier, dto.amount);
    const maxCoverageLimit = getCoverageLimit(dto.claimType, dto.customerTier);

    if (dto.amount > maxCoverageLimit) {
      throw new BadRequestException(
        `Claim amount exceeds maximum coverage limit of ${maxCoverageLimit} for tier ${dto.customerTier} and type ${dto.claimType}.`
      );
    }

    const currentFlags: FraudFlag[] = dto.fraudFlags ? [...dto.fraudFlags] : [];
    const calculatedFraudScore = this.calculateInitialFraudScore(
      incidentDate,
      filingDate,
      dto,
      processedLineItems,
      currentFlags
    );

    const { status: initialStatus, approvedAmount: calculatedApprovedAmount, auditLogs } =
      this.determineInitialStatusAndApproval(dto, calculatedFraudScore, calculatedDeductible);

    const claimId = `CLM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newClaim: Claim = {
      id: claimId,
      policyNumber: dto.policyNumber,
      customerId: dto.customerId,
      customerTier: dto.customerTier,
      claimType: dto.claimType,
      amount: dto.amount,
      dateOfIncident: dto.dateOfIncident,
      filingDate: dto.filingDate,
      description: dto.description,
      lineItems: processedLineItems,
      fraudFlags: currentFlags,
      status: initialStatus,
      approvedAmount: calculatedApprovedAmount,
      deductible: calculatedDeductible,
      fraudScore: calculatedFraudScore,
      auditTrail: auditLogs,
    };

    this.claimsDb.set(claimId, newClaim);
    return newClaim;
  }

  @Get(':id')
  public getClaimById(
    @Param('id') id: string,
    @Query('includeRiskStats') includeRiskStats?: string
  ): Claim & { riskStats?: any } {
    const claim = this.findClaimOrThrow(id);

    if (includeRiskStats === 'true') {
      const riskCategory = this.determineRiskCategory(claim.fraudScore);
      const flaggedItemsCount = claim.lineItems.filter((item) => item.flagged).length;

      return {
        ...claim,
        riskStats: {
          riskCategory,
          totalFlags: claim.fraudFlags.length,
          flaggedItemsCount,
          isHighValue: claim.amount > 50000,
        },
      };
    }

    return claim;
  }

  @Put(':id/evaluate')
  public reevaluateClaim(@Param('id') id: string, @Body() dto: EvaluateClaimDto): Claim {
    const claim = this.findClaimOrThrow(id);

    if (claim.status === 'PAID' || claim.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot re-evaluate a claim in ${claim.status} status.`);
    }

    if (claim.status === 'APPROVED' && !dto.forceReevaluation) {
      throw new BadRequestException('Approved claim cannot be re-evaluated without forceReevaluation flag.');
    }

    if (dto.additionalFraudFlags && dto.additionalFraudFlags.length > 0) {
      for (const flag of dto.additionalFraudFlags) {
        if (!claim.fraudFlags.includes(flag)) {
          claim.fraudFlags.push(flag);
          claim.auditTrail.push(`Added new fraud flag: ${flag}`);
        }
      }
    }

    if (dto.updatedLineItems && dto.updatedLineItems.length > 0) {
      let newTotal = 0;
      const newItems: LineItem[] = [];
      for (const uItem of dto.updatedLineItems) {
        if (uItem.amount <= 0) {
          throw new BadRequestException('Updated line item amount must be greater than zero.');
        }
        newTotal += uItem.amount;

        let isFlagged = uItem.flagged || false;
        if (uItem.amount > 10000) {
          isFlagged = true;
        }

        if (claim.claimType === 'HEALTH' && uItem.category === 'COSMETIC' && claim.customerTier !== 'DIAMOND') {
          isFlagged = true;
        } else if (claim.claimType === 'AUTO' && uItem.category === 'RACING') {
          isFlagged = true;
        } else if (claim.claimType === 'HOME' && uItem.category === 'WEAR_AND_TEAR') {
          isFlagged = true;
        }

        newItems.push({
          id: uItem.id,
          description: uItem.description,
          amount: uItem.amount,
          category: uItem.category,
          flagged: isFlagged,
        });
      }
      claim.lineItems = newItems;
      claim.amount = newTotal;
      claim.auditTrail.push(`Line items updated. New total amount: ${newTotal}`);
    }

    let recalculatedScore = 0;
    const incidentDate = new Date(claim.dateOfIncident);
    const filingDate = new Date(claim.filingDate);
    const daysDiff = getDaysBetween(filingDate, incidentDate);

    if (daysDiff > 90) recalculatedScore += 25;
    else if (daysDiff > 30) recalculatedScore += 10;

    for (const item of claim.lineItems) {
      if (item.flagged) {
        recalculatedScore += 15;
      }
    }

    if (claim.customerTier === 'BRONZE' && claim.amount > 10000) {
      recalculatedScore += 20;
    }

    recalculatedScore += calculateFlagScoreSum(claim.fraudFlags);
    claim.fraudScore = recalculatedScore;
    claim.deductible = calculateDeductible(claim.customerTier, claim.amount);

    if (claim.fraudScore >= 75) {
      claim.status = 'REJECTED';
      claim.approvedAmount = 0;
      claim.auditTrail.push(`Re-evaluation resulted in REJECTED status (score: ${claim.fraudScore}).`);
    } else if (claim.fraudScore >= 40) {
      claim.status = 'MANUAL_AUDIT_REQUIRED';
      claim.approvedAmount = 0;
      claim.auditTrail.push(`Re-evaluation resulted in MANUAL_AUDIT_REQUIRED status (score: ${claim.fraudScore}).`);
    } else {
      claim.status = 'UNDER_REVIEW';
      claim.approvedAmount = 0;
      claim.auditTrail.push(`Re-evaluation completed. Status reset to UNDER_REVIEW (score: ${claim.fraudScore}).`);
    }

    this.claimsDb.set(id, claim);
    return claim;
  }

  @Put(':id/manual-review')
  public manualReview(@Param('id') id: string, @Body() dto: ManualReviewDto): Claim {
    const claim = this.findClaimOrThrow(id);

    if (claim.status === 'PAID' || claim.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot process manual review on a claim in ${claim.status} status.`);
    }

    if (!dto.adjusterId || !dto.adjusterLevel || !dto.decision || !dto.reason) {
      throw new BadRequestException('Missing required fields for manual review.');
    }

    if (claim.fraudFlags.includes('BLACK_LISTED_IP') && dto.adjusterLevel < 3) {
      throw new ForbiddenException('Claims with BLACK_LISTED_IP require Adjuster Level 3 or higher.');
    }

    if (dto.decision === 'APPROVE') {
      this.handleManualApproval(claim, dto);
    } else if (dto.decision === 'REJECT') {
      claim.status = 'REJECTED';
      claim.approvedAmount = 0;
      claim.auditTrail.push(
        `Rejected by adjuster ${dto.adjusterId} (L${dto.adjusterLevel}). Reason: ${dto.reason}`
      );
    } else if (dto.decision === 'ESCALATE') {
      if (dto.adjusterLevel >= 4) {
        throw new BadRequestException('Level 4 adjusters cannot escalate claims further.');
      }
      claim.status = 'MANUAL_AUDIT_REQUIRED';
      claim.auditTrail.push(
        `Escalated by adjuster ${dto.adjusterId} (L${dto.adjusterLevel}). Reason: ${dto.reason}`
      );
    } else {
      throw new BadRequestException('Invalid decision specified.');
    }

    this.claimsDb.set(id, claim);
    return claim;
  }

  @Delete(':id')
  public cancelOrDeleteClaim(
    @Param('id') id: string,
    @Query('reason') reason?: string
  ): { message: string; claimId: string; status: ClaimStatus } {
    const claim = this.findClaimOrThrow(id);

    if (claim.status === 'PAID') {
      throw new BadRequestException('Cannot cancel or delete a claim that has already been paid.');
    }

    if (claim.status === 'APPROVED' || claim.status === 'PAYMENT_PENDING') {
      this.validateCancellationWindow(claim);
    }

    if (claim.status === 'DRAFT') {
      this.claimsDb.delete(id);
      return {
        message: 'Draft claim deleted permanently.',
        claimId: id,
        status: 'CANCELLED',
      };
    }

    claim.status = 'CANCELLED';
    claim.approvedAmount = 0;
    claim.auditTrail.push(
      `Claim cancelled on request. Reason: ${reason || 'No reason provided.'}`
    );

    this.claimsDb.set(id, claim);

    return {
      message: 'Claim status successfully set to CANCELLED.',
      claimId: id,
      status: claim.status,
    };
  }

  private findClaimOrThrow(id: string): Claim {
    const claim = this.claimsDb.get(id);
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found.`);
    }
    return claim;
  }

  private validateCreateClaimDto(dto: CreateClaimDto): void {
    if (!dto.policyNumber || !dto.customerId || !dto.claimType || !dto.customerTier) {
      throw new BadRequestException('Missing required core fields.');
    }

    if (dto.amount <= 0) {
      throw new BadRequestException('Claim amount must be greater than zero.');
    }
  }

  private validateDates(incidentDate: Date, filingDate: Date, now: Date): void {
    if (isNaN(incidentDate.getTime()) || isNaN(filingDate.getTime())) {
      throw new BadRequestException('Invalid date formats provided.');
    }

    if (incidentDate > now || filingDate > now) {
      throw new BadRequestException('Dates cannot be in the future.');
    }

    if (filingDate < incidentDate) {
      throw new BadRequestException('Filing date cannot be prior to incident date.');
    }
  }

  private processInitialLineItems(
    lineItems: CreateClaimDto['lineItems'] | undefined,
    claimAmount: number
  ): LineItem[] {
    const processedLineItems: LineItem[] = [];
    if (lineItems && lineItems.length > 0) {
      let itemSum = 0;
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        if (item.amount <= 0) {
          throw new BadRequestException('Line item amount must be positive.');
        }
        itemSum += item.amount;
        processedLineItems.push({
          id: item.id || `item-${i + 1}`,
          description: item.description,
          amount: item.amount,
          category: item.category,
          flagged: false,
        });
      }
      if (Math.abs(itemSum - claimAmount) > 0.01) {
        throw new BadRequestException('Sum of line items does not match total claim amount.');
      }
    }
    return processedLineItems;
  }

  private calculateInitialFraudScore(
    incidentDate: Date,
    filingDate: Date,
    dto: CreateClaimDto,
    lineItems: LineItem[],
    currentFlags: FraudFlag[]
  ): number {
    let score = 0;

    const daysDifference = getDaysBetween(filingDate, incidentDate);
    if (daysDifference > 90) {
      score += 25;
    } else if (daysDifference > 30) {
      score += 10;
    }

    for (const item of lineItems) {
      if (item.amount > 10000) {
        score += 15;
        item.flagged = true;
      }
      if (dto.claimType === 'HEALTH' && item.category === 'COSMETIC' && dto.customerTier !== 'DIAMOND') {
        score += 30;
        item.flagged = true;
      } else if (dto.claimType === 'AUTO' && item.category === 'RACING') {
        score += 50;
        item.flagged = true;
      } else if (dto.claimType === 'HOME' && item.category === 'WEAR_AND_TEAR') {
        score += 20;
        item.flagged = true;
      }
    }

    if (dto.customerTier === 'BRONZE' && dto.amount > 10000) {
      score += 20;
    }

    score += calculateFlagScoreSum(currentFlags);
    return score;
  }

  private determineInitialStatusAndApproval(
    dto: CreateClaimDto,
    fraudScore: number,
    deductible: number
  ): { status: ClaimStatus; approvedAmount: number; auditLogs: string[] } {
    let status: ClaimStatus = 'UNDER_REVIEW';
    let approvedAmount = 0;
    const auditLogs: string[] = [`Claim created with initial fraud score of ${fraudScore}.`];

    if (fraudScore >= 75) {
      status = 'REJECTED';
      approvedAmount = 0;
      auditLogs.push('System auto-rejected claim due to high fraud risk score (>= 75).');
    } else if (fraudScore >= 40) {
      status = 'MANUAL_AUDIT_REQUIRED';
      approvedAmount = 0;
      auditLogs.push('System escalated claim to manual audit due to elevated fraud risk score (>= 40).');
    } else {
      if (dto.claimType === 'HEALTH') {
        if (dto.amount <= 1000 && fraudScore < 20) {
          status = 'APPROVED';
          approvedAmount = Math.max(0, dto.amount - deductible);
          auditLogs.push('System auto-approved HEALTH claim under $1000 threshold.');
        } else {
          status = 'UNDER_REVIEW';
        }
      } else if (dto.claimType === 'AUTO') {
        if (
          dto.amount <= 2000 &&
          fraudScore < 15 &&
          (dto.customerTier === 'GOLD' || dto.customerTier === 'PLATINUM' || dto.customerTier === 'DIAMOND')
        ) {
          status = 'APPROVED';
          approvedAmount = Math.max(0, dto.amount - deductible);
          auditLogs.push('System auto-approved AUTO claim for privileged tier.');
        } else {
          status = 'UNDER_REVIEW';
        }
      } else if (dto.claimType === 'TRAVEL') {
        if (dto.amount <= 500 && fraudScore < 10) {
          status = 'APPROVED';
          approvedAmount = Math.max(0, dto.amount - deductible);
          auditLogs.push('System auto-approved TRAVEL claim under $500 threshold.');
        } else {
          status = 'UNDER_REVIEW';
        }
      } else {
        status = 'UNDER_REVIEW';
      }
    }

    return { status, approvedAmount, auditLogs };
  }

  private determineRiskCategory(score: number): string {
    if (score >= 75) return 'CRITICAL';
    if (score >= 50) return 'HIGH';
    if (score >= 25) return 'MEDIUM';
    return 'LOW';
  }

  private handleManualApproval(claim: Claim, dto: ManualReviewDto): void {
    const maxApproveLimit = ADJUSTER_APPROVAL_LIMITS[dto.adjusterLevel];
    if (maxApproveLimit === undefined) {
      throw new BadRequestException('Invalid adjuster level.');
    }

    const targetAmount = dto.overrideAmount !== undefined ? dto.overrideAmount : claim.amount - claim.deductible;

    if (targetAmount > maxApproveLimit) {
      throw new ForbiddenException(
        `Adjuster level ${dto.adjusterLevel} cannot approve amounts greater than ${maxApproveLimit}. Target was ${targetAmount}.`
      );
    }

    if (dto.overrideAmount !== undefined) {
      if (dto.overrideAmount < 0 || dto.overrideAmount > claim.amount) {
        throw new BadRequestException('Override amount must be non-negative and cannot exceed total claim amount.');
      }
      claim.approvedAmount = dto.overrideAmount;
    } else {
      claim.approvedAmount = Math.max(0, claim.amount - claim.deductible);
    }

    if (claim.fraudScore >= 50 && (!dto.mitigationNotes || dto.mitigationNotes.length < 2)) {
      throw new BadRequestException(
        'Approval of high risk claims (fraud score >= 50) requires at least 2 mitigation notes.'
      );
    }

    claim.status = 'APPROVED';
    claim.auditTrail.push(
      `Approved by adjuster ${dto.adjusterId} (L${dto.adjusterLevel}). Approved Amount: ${claim.approvedAmount}. Reason: ${dto.reason}`
    );
  }

  private validateCancellationWindow(claim: Claim): void {
    const filingDate = new Date(claim.filingDate);
    const now = new Date();
    const diffDays = getDaysBetween(now, filingDate);

    if (claim.customerTier === 'PLATINUM' || claim.customerTier === 'DIAMOND') {
      if (diffDays > 30) {
        throw new ForbiddenException(
          'Approved/Pending claims for PLATINUM/DIAMOND tiers cannot be cancelled after 30 days.'
        );
      }
    } else {
      if (diffDays > 7) {
        throw new ForbiddenException(
          'Approved/Pending claims for non-premium tiers cannot be cancelled after 7 days.'
        );
      }
    }
  }
}