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

const DEDUCTIBLE_RULES: Record<CustomerTier, (amount: number) => number> = {
  BRONZE: (amount) => Math.max(500, amount * 0.20),
  SILVER: (amount) => Math.max(300, amount * 0.15),
  GOLD: (amount) => Math.max(100, amount * 0.10),
  PLATINUM: (amount) => amount * 0.05,
  DIAMOND: () => 0,
};

const COVERAGE_LIMITS: Record<ClaimType, Record<CustomerTier, number>> = {
  HEALTH: { BRONZE: 5000, SILVER: 15000, GOLD: 50000, PLATINUM: 200000, DIAMOND: 1000000 },
  AUTO: { BRONZE: 10000, SILVER: 25000, GOLD: 75000, PLATINUM: 150000, DIAMOND: 500000 },
  HOME: { BRONZE: 20000, SILVER: 50000, GOLD: 200000, PLATINUM: 500000, DIAMOND: 2000000 },
  TRAVEL: { BRONZE: 2000, SILVER: 5000, GOLD: 15000, PLATINUM: 50000, DIAMOND: 100000 },
  LIFE: { BRONZE: 50000, SILVER: 100000, GOLD: 500000, PLATINUM: 1000000, DIAMOND: 5000000 },
};

const FRAUD_FLAG_SCORES: Record<FraudFlag, number> = {
  BLACK_LISTED_IP: 50,
  UNLICENSED_PROVIDER: 40,
  DUPLICATE_RECEIPT: 30,
  HIGH_FREQUENCY_CLAIMS: 25,
  RECENT_POLICY_CHANGE: 20,
  SUSPICIOUS_LOCATION: 15,
};

const ADJUSTER_LIMITS: Record<number, number> = {
  1: 5000,
  2: 25000,
  3: 100000,
  4: Number.MAX_SAFE_INTEGER,
};

function calculateDeductible(tier: CustomerTier, amount: number): number {
  const rule = DEDUCTIBLE_RULES[tier];
  if (!rule) {
    throw new BadRequestException('Invalid customer tier.');
  }
  return rule(amount);
}

function getCoverageLimit(claimType: ClaimType, customerTier: CustomerTier): number {
  const typeLimits = COVERAGE_LIMITS[claimType];
  if (!typeLimits) {
    throw new BadRequestException('Invalid claim type.');
  }
  const limit = typeLimits[customerTier];
  if (!limit) {
    throw new BadRequestException('Invalid customer tier.');
  }
  return limit;
}

function calculateFlagsScore(flags: FraudFlag[]): number {
  return flags.reduce((sum, flag) => sum + (FRAUD_FLAG_SCORES[flag] || 0), 0);
}

function calculateDaysDifference(dateOfIncident: string, filingDate: string): number {
  const incidentDate = new Date(dateOfIncident);
  const filing = new Date(filingDate);
  return (filing.getTime() - incidentDate.getTime()) / (1000 * 3600 * 24);
}

function getDelayFraudScore(daysDifference: number): number {
  if (daysDifference > 90) return 25;
  if (daysDifference > 30) return 10;
  return 0;
}

function validateCreateClaimDto(dto: CreateClaimDto): void {
  const coreFields = [dto.policyNumber, dto.customerId, dto.claimType, dto.customerTier];
  if (coreFields.some((field) => !field)) {
    throw new BadRequestException('Missing required core fields.');
  }

  if (dto.amount <= 0) {
    throw new BadRequestException('Claim amount must be greater than zero.');
  }

  const incidentDate = new Date(dto.dateOfIncident);
  const filingDate = new Date(dto.filingDate);
  const now = new Date();
  const dates = [incidentDate, filingDate];

  if (dates.some((d) => isNaN(d.getTime()))) {
    throw new BadRequestException('Invalid date formats provided.');
  }

  if (dates.some((d) => d > now)) {
    throw new BadRequestException('Dates cannot be in the future.');
  }

  if (filingDate < incidentDate) {
    throw new BadRequestException('Filing date cannot be prior to incident date.');
  }
}

function processInitialLineItems(
  lineItems: CreateClaimDto['lineItems'] | undefined,
  totalAmount: number
): LineItem[] {
  if (!lineItems || lineItems.length === 0) {
    return [];
  }

  let itemSum = 0;
  const processed = lineItems.map((item, index) => {
    if (item.amount <= 0) {
      throw new BadRequestException('Line item amount must be positive.');
    }
    itemSum += item.amount;
    return {
      id: item.id || `item-${index + 1}`,
      description: item.description,
      amount: item.amount,
      category: item.category,
      flagged: false,
    };
  });

  if (Math.abs(itemSum - totalAmount) > 0.01) {
    throw new BadRequestException('Sum of line items does not match total claim amount.');
  }

  return processed;
}

function evaluateLineItem(
  item: LineItem,
  claimType: ClaimType,
  customerTier: CustomerTier
): { flagged: boolean; score: number } {
  let score = 0;
  let flagged = false;

  if (item.amount > 10000) {
    score += 15;
    flagged = true;
  }

  if (claimType === 'HEALTH' && item.category === 'COSMETIC' && customerTier !== 'DIAMOND') {
    score += 30;
    flagged = true;
  } else if (claimType === 'AUTO' && item.category === 'RACING') {
    score += 50;
    flagged = true;
  } else if (claimType === 'HOME' && item.category === 'WEAR_AND_TEAR') {
    score += 20;
    flagged = true;
  }

  return { flagged, score };
}

interface AutoApproveRule {
  isEligible: (amount: number, score: number, tier: CustomerTier) => boolean;
  auditMessage: string;
}

const AUTO_APPROVE_RULES: Partial<Record<ClaimType, AutoApproveRule>> = {
  HEALTH: {
    isEligible: (amount, score) => amount <= 1000 && score < 20,
    auditMessage: 'System auto-approved HEALTH claim under $1000 threshold.',
  },
  AUTO: {
    isEligible: (amount, score, tier) =>
      amount <= 2000 && score < 15 && (tier === 'GOLD' || tier === 'PLATINUM' || tier === 'DIAMOND'),
    auditMessage: 'System auto-approved AUTO claim for privileged tier.',
  },
  TRAVEL: {
    isEligible: (amount, score) => amount <= 500 && score < 10,
    auditMessage: 'System auto-approved TRAVEL claim under $500 threshold.',
  },
};

function determineInitialClaimState(
  dto: CreateClaimDto,
  fraudScore: number,
  deductible: number
): { status: ClaimStatus; approvedAmount: number; auditLogs: string[] } {
  const auditLogs = [`Claim created with initial fraud score of ${fraudScore}.`];

  if (fraudScore >= 75) {
    auditLogs.push('System auto-rejected claim due to high fraud risk score (>= 75).');
    return { status: 'REJECTED', approvedAmount: 0, auditLogs };
  }

  if (fraudScore >= 40) {
    auditLogs.push('System escalated claim to manual audit due to elevated fraud risk score (>= 40).');
    return { status: 'MANUAL_AUDIT_REQUIRED', approvedAmount: 0, auditLogs };
  }

  const rule = AUTO_APPROVE_RULES[dto.claimType];
  if (rule && rule.isEligible(dto.amount, fraudScore, dto.customerTier)) {
    auditLogs.push(rule.auditMessage);
    return {
      status: 'APPROVED',
      approvedAmount: Math.max(0, dto.amount - deductible),
      auditLogs,
    };
  }

  return { status: 'UNDER_REVIEW', approvedAmount: 0, auditLogs };
}

function isItemFlagged(
  item: { amount: number; category: string; flagged?: boolean },
  claimType: ClaimType,
  customerTier: CustomerTier
): boolean {
  if (item.flagged || item.amount > 10000) return true;
  if (claimType === 'HEALTH' && item.category === 'COSMETIC' && customerTier !== 'DIAMOND') return true;
  if (claimType === 'AUTO' && item.category === 'RACING') return true;
  if (claimType === 'HOME' && item.category === 'WEAR_AND_TEAR') return true;
  return false;
}

function validateReevaluatable(claim: Claim, forceReevaluation?: boolean): void {
  if (claim.status === 'PAID' || claim.status === 'CANCELLED') {
    throw new BadRequestException(`Cannot re-evaluate a claim in ${claim.status} status.`);
  }

  if (claim.status === 'APPROVED' && !forceReevaluation) {
    throw new BadRequestException('Approved claim cannot be re-evaluated without forceReevaluation flag.');
  }
}

function applyAdditionalFraudFlags(claim: Claim, additionalFlags?: FraudFlag[]): void {
  if (!additionalFlags || additionalFlags.length === 0) return;

  for (const flag of additionalFlags) {
    if (!claim.fraudFlags.includes(flag)) {
      claim.fraudFlags.push(flag);
      claim.auditTrail.push(`Added new fraud flag: ${flag}`);
    }
  }
}

function updateClaimLineItems(
  claim: Claim,
  updatedLineItems?: EvaluateClaimDto['updatedLineItems']
): void {
  if (!updatedLineItems || updatedLineItems.length === 0) return;

  let newTotal = 0;
  const newItems: LineItem[] = updatedLineItems.map((uItem) => {
    if (uItem.amount <= 0) {
      throw new BadRequestException('Updated line item amount must be greater than zero.');
    }
    newTotal += uItem.amount;

    const isFlagged = isItemFlagged(uItem, claim.claimType, claim.customerTier);

    return {
      id: uItem.id,
      description: uItem.description,
      amount: uItem.amount,
      category: uItem.category,
      flagged: isFlagged,
    };
  });

  claim.lineItems = newItems;
  claim.amount = newTotal;
  claim.auditTrail.push(`Line items updated. New total amount: ${newTotal}`);
}

function recalculateClaimFraudScore(claim: Claim): number {
  let score = getDelayFraudScore(calculateDaysDifference(claim.dateOfIncident, claim.filingDate));

  for (const item of claim.lineItems) {
    if (item.flagged) {
      score += 15;
    }
  }

  if (claim.customerTier === 'BRONZE' && claim.amount > 10000) {
    score += 20;
  }

  score += calculateFlagsScore(claim.fraudFlags);
  return score;
}

function applyReevaluationStatus(claim: Claim): void {
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
}

function validateManualReviewDto(claim: Claim, dto: ManualReviewDto): void {
  if (claim.status === 'PAID' || claim.status === 'CANCELLED') {
    throw new BadRequestException(`Cannot process manual review on a claim in ${claim.status} status.`);
  }

  if (!dto.adjusterId || !dto.adjusterLevel || !dto.decision || !dto.reason) {
    throw new BadRequestException('Missing required fields for manual review.');
  }

  if (claim.fraudFlags.includes('BLACK_LISTED_IP') && dto.adjusterLevel < 3) {
    throw new ForbiddenException('Claims with BLACK_LISTED_IP require Adjuster Level 3 or higher.');
  }
}

function handleManualApprove(claim: Claim, dto: ManualReviewDto): void {
  const maxApproveLimit = ADJUSTER_LIMITS[dto.adjusterLevel];
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

const DECISION_HANDLERS: Record<string, (claim: Claim, dto: ManualReviewDto) => void> = {
  APPROVE: handleManualApprove,
  REJECT: (claim, dto) => {
    claim.status = 'REJECTED';
    claim.approvedAmount = 0;
    claim.auditTrail.push(
      `Rejected by adjuster ${dto.adjusterId} (L${dto.adjusterLevel}). Reason: ${dto.reason}`
    );
  },
  ESCALATE: (claim, dto) => {
    if (dto.adjusterLevel >= 4) {
      throw new BadRequestException('Level 4 adjusters cannot escalate claims further.');
    }
    claim.status = 'MANUAL_AUDIT_REQUIRED';
    claim.auditTrail.push(
      `Escalated by adjuster ${dto.adjusterId} (L${dto.adjusterLevel}). Reason: ${dto.reason}`
    );
  },
};

function validateCancellationPeriod(claim: Claim): void {
  if (claim.status !== 'APPROVED' && claim.status !== 'PAYMENT_PENDING') {
    return;
  }

  const filingDate = new Date(claim.filingDate);
  const diffDays = (new Date().getTime() - filingDate.getTime()) / (1000 * 3600 * 24);
  const isPremiumTier = claim.customerTier === 'PLATINUM' || claim.customerTier === 'DIAMOND';
  const allowedDays = isPremiumTier ? 30 : 7;

  if (diffDays > allowedDays) {
    const errorMsg = isPremiumTier
      ? 'Approved/Pending claims for PLATINUM/DIAMOND tiers cannot be cancelled after 30 days.'
      : 'Approved/Pending claims for non-premium tiers cannot be cancelled after 7 days.';
    throw new ForbiddenException(errorMsg);
  }
}

@Controller('insurance-claims')
export class InsuranceClaimsController {
  private claimsDb: Map<string, Claim> = new Map();

  @Post()
  public createAndEvaluateClaim(@Body() dto: CreateClaimDto): Claim {
    validateCreateClaimDto(dto);

    const processedLineItems = processInitialLineItems(dto.lineItems, dto.amount);
    const calculatedDeductible = calculateDeductible(dto.customerTier, dto.amount);
    const maxCoverageLimit = getCoverageLimit(dto.claimType, dto.customerTier);

    if (dto.amount > maxCoverageLimit) {
      throw new BadRequestException(
        `Claim amount exceeds maximum coverage limit of ${maxCoverageLimit} for tier ${dto.customerTier} and type ${dto.claimType}.`
      );
    }

    const currentFlags: FraudFlag[] = dto.fraudFlags ? [...dto.fraudFlags] : [];

    let calculatedFraudScore = getDelayFraudScore(calculateDaysDifference(dto.dateOfIncident, dto.filingDate));

    if (dto.customerTier === 'BRONZE' && dto.amount > 10000) {
      calculatedFraudScore += 20;
    }

    for (const item of processedLineItems) {
      const { flagged, score } = evaluateLineItem(item, dto.claimType, dto.customerTier);
      if (flagged) {
        item.flagged = true;
      }
      calculatedFraudScore += score;
    }

    calculatedFraudScore += calculateFlagsScore(currentFlags);

    const initialState = determineInitialClaimState(dto, calculatedFraudScore, calculatedDeductible);

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
      status: initialState.status,
      approvedAmount: initialState.approvedAmount,
      deductible: calculatedDeductible,
      fraudScore: calculatedFraudScore,
      auditTrail: initialState.auditLogs,
    };

    this.claimsDb.set(claimId, newClaim);
    return newClaim;
  }

  @Get(':id')
  public getClaimById(@Param('id') id: string, @Query('includeRiskStats') includeRiskStats?: string): Claim & { riskStats?: any } {
    const claim = this.claimsDb.get(id);
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found.`);
    }

    if (includeRiskStats === 'true') {
      let riskCategory = 'LOW';
      if (claim.fraudScore >= 75) {
        riskCategory = 'CRITICAL';
      } else if (claim.fraudScore >= 50) {
        riskCategory = 'HIGH';
      } else if (claim.fraudScore >= 25) {
        riskCategory = 'MEDIUM';
      }

      let flaggedItemsCount = 0;
      for (let i = 0; i < claim.lineItems.length; i++) {
        if (claim.lineItems[i].flagged) {
          flaggedItemsCount++;
        }
      }

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
    const claim = this.claimsDb.get(id);
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found.`);
    }

    validateReevaluatable(claim, dto.forceReevaluation);
    applyAdditionalFraudFlags(claim, dto.additionalFraudFlags);
    updateClaimLineItems(claim, dto.updatedLineItems);

    claim.fraudScore = recalculateClaimFraudScore(claim);
    claim.deductible = calculateDeductible(claim.customerTier, claim.amount);
    applyReevaluationStatus(claim);

    this.claimsDb.set(id, claim);
    return claim;
  }

  @Put(':id/manual-review')
  public manualReview(@Param('id') id: string, @Body() dto: ManualReviewDto): Claim {
    const claim = this.claimsDb.get(id);
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found.`);
    }

    validateManualReviewDto(claim, dto);

    const handler = DECISION_HANDLERS[dto.decision];
    if (!handler) {
      throw new BadRequestException('Invalid decision specified.');
    }

    handler(claim, dto);

    this.claimsDb.set(id, claim);
    return claim;
  }

  @Delete(':id')
  public cancelOrDeleteClaim(
    @Param('id') id: string,
    @Query('reason') reason?: string
  ): { message: string; claimId: string; status: ClaimStatus } {
    const claim = this.claimsDb.get(id);
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found.`);
    }

    if (claim.status === 'PAID') {
      throw new BadRequestException('Cannot cancel or delete a claim that has already been paid.');
    }

    validateCancellationPeriod(claim);

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
    claim.auditTrail.push(`Claim cancelled on request. Reason: ${reason || 'No reason provided.'}`);

    this.claimsDb.set(id, claim);

    return {
      message: 'Claim status successfully set to CANCELLED.',
      claimId: id,
      status: claim.status,
    };
  }
}