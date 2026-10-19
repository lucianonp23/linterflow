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

@Controller('insurance-claims')
export class InsuranceClaimsController {
  private claimsDb: Map<string, Claim> = new Map();

  @Post()
  public createAndEvaluateClaim(@Body() dto: CreateClaimDto): Claim {
    if (!dto.policyNumber || !dto.customerId || !dto.claimType || !dto.customerTier) {
      throw new BadRequestException('Missing required core fields.');
    }

    if (dto.amount <= 0) {
      throw new BadRequestException('Claim amount must be greater than zero.');
    }

    const incidentDate = new Date(dto.dateOfIncident);
    const filingDate = new Date(dto.filingDate);
    const now = new Date();

    if (isNaN(incidentDate.getTime()) || isNaN(filingDate.getTime())) {
      throw new BadRequestException('Invalid date formats provided.');
    }

    if (incidentDate > now || filingDate > now) {
      throw new BadRequestException('Dates cannot be in the future.');
    }

    if (filingDate < incidentDate) {
      throw new BadRequestException('Filing date cannot be prior to incident date.');
    }

    let itemSum = 0;
    const processedLineItems: LineItem[] = [];
    if (dto.lineItems && dto.lineItems.length > 0) {
      for (let i = 0; i < dto.lineItems.length; i++) {
        const item = dto.lineItems[i];
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
      if (Math.abs(itemSum - dto.amount) > 0.01) {
        throw new BadRequestException('Sum of line items does not match total claim amount.');
      }
    }

    let calculatedDeductible = 0;
    switch (dto.customerTier) {
      case 'BRONZE':
        calculatedDeductible = Math.max(500, dto.amount * 0.20);
        break;
      case 'SILVER':
        calculatedDeductible = Math.max(300, dto.amount * 0.15);
        break;
      case 'GOLD':
        calculatedDeductible = Math.max(100, dto.amount * 0.10);
        break;
      case 'PLATINUM':
        calculatedDeductible = dto.amount * 0.05;
        break;
      case 'DIAMOND':
        calculatedDeductible = 0;
        break;
      default:
        throw new BadRequestException('Invalid customer tier.');
    }

    let maxCoverageLimit = 0;
    switch (dto.claimType) {
      case 'HEALTH':
        if (dto.customerTier === 'BRONZE') maxCoverageLimit = 5000;
        else if (dto.customerTier === 'SILVER') maxCoverageLimit = 15000;
        else if (dto.customerTier === 'GOLD') maxCoverageLimit = 50000;
        else if (dto.customerTier === 'PLATINUM') maxCoverageLimit = 200000;
        else if (dto.customerTier === 'DIAMOND') maxCoverageLimit = 1000000;
        break;
      case 'AUTO':
        if (dto.customerTier === 'BRONZE') maxCoverageLimit = 10000;
        else if (dto.customerTier === 'SILVER') maxCoverageLimit = 25000;
        else if (dto.customerTier === 'GOLD') maxCoverageLimit = 75000;
        else if (dto.customerTier === 'PLATINUM') maxCoverageLimit = 150000;
        else if (dto.customerTier === 'DIAMOND') maxCoverageLimit = 500000;
        break;
      case 'HOME':
        if (dto.customerTier === 'BRONZE') maxCoverageLimit = 20000;
        else if (dto.customerTier === 'SILVER') maxCoverageLimit = 50000;
        else if (dto.customerTier === 'GOLD') maxCoverageLimit = 200000;
        else if (dto.customerTier === 'PLATINUM') maxCoverageLimit = 500000;
        else if (dto.customerTier === 'DIAMOND') maxCoverageLimit = 2000000;
        break;
      case 'TRAVEL':
        if (dto.customerTier === 'BRONZE') maxCoverageLimit = 2000;
        else if (dto.customerTier === 'SILVER') maxCoverageLimit = 5000;
        else if (dto.customerTier === 'GOLD') maxCoverageLimit = 15000;
        else if (dto.customerTier === 'PLATINUM') maxCoverageLimit = 50000;
        else if (dto.customerTier === 'DIAMOND') maxCoverageLimit = 100000;
        break;
      case 'LIFE':
        if (dto.customerTier === 'BRONZE') maxCoverageLimit = 50000;
        else if (dto.customerTier === 'SILVER') maxCoverageLimit = 100000;
        else if (dto.customerTier === 'GOLD') maxCoverageLimit = 500000;
        else if (dto.customerTier === 'PLATINUM') maxCoverageLimit = 1000000;
        else if (dto.customerTier === 'DIAMOND') maxCoverageLimit = 5000000;
        break;
      default:
        throw new BadRequestException('Invalid claim type.');
    }

    if (dto.amount > maxCoverageLimit) {
      throw new BadRequestException(
        `Claim amount exceeds maximum coverage limit of ${maxCoverageLimit} for tier ${dto.customerTier} and type ${dto.claimType}.`
      );
    }

    let calculatedFraudScore = 0;
    const currentFlags: FraudFlag[] = dto.fraudFlags ? [...dto.fraudFlags] : [];

    const daysDifference = (filingDate.getTime() - incidentDate.getTime()) / (1000 * 3600 * 24);
    if (daysDifference > 90) {
      calculatedFraudScore += 25;
    } else if (daysDifference > 30) {
      calculatedFraudScore += 10;
    }

    if (processedLineItems.length > 0) {
      for (let j = 0; j < processedLineItems.length; j++) {
        const item = processedLineItems[j];
        if (item.amount > 10000) {
          calculatedFraudScore += 15;
          item.flagged = true;
        }
        if (dto.claimType === 'HEALTH' && item.category === 'COSMETIC' && dto.customerTier !== 'DIAMOND') {
          calculatedFraudScore += 30;
          item.flagged = true;
        } else if (dto.claimType === 'AUTO' && item.category === 'RACING') {
          calculatedFraudScore += 50;
          item.flagged = true;
        } else if (dto.claimType === 'HOME' && item.category === 'WEAR_AND_TEAR') {
          calculatedFraudScore += 20;
          item.flagged = true;
        }
      }
    }

    if (dto.customerTier === 'BRONZE' && dto.amount > 10000) {
      calculatedFraudScore += 20;
    }

    for (let k = 0; k < currentFlags.length; k++) {
      const flag = currentFlags[k];
      switch (flag) {
        case 'BLACK_LISTED_IP':
          calculatedFraudScore += 50;
          break;
        case 'UNLICENSED_PROVIDER':
          calculatedFraudScore += 40;
          break;
        case 'DUPLICATE_RECEIPT':
          calculatedFraudScore += 30;
          break;
        case 'HIGH_FREQUENCY_CLAIMS':
          calculatedFraudScore += 25;
          break;
        case 'RECENT_POLICY_CHANGE':
          calculatedFraudScore += 20;
          break;
        case 'SUSPICIOUS_LOCATION':
          calculatedFraudScore += 15;
          break;
      }
    }

    let initialStatus: ClaimStatus = 'UNDER_REVIEW';
    let calculatedApprovedAmount = 0;
    const auditLogs: string[] = [`Claim created with initial fraud score of ${calculatedFraudScore}.`];

    if (calculatedFraudScore >= 75) {
      initialStatus = 'REJECTED';
      calculatedApprovedAmount = 0;
      auditLogs.push('System auto-rejected claim due to high fraud risk score (>= 75).');
    } else if (calculatedFraudScore >= 40) {
      initialStatus = 'MANUAL_AUDIT_REQUIRED';
      calculatedApprovedAmount = 0;
      auditLogs.push('System escalated claim to manual audit due to elevated fraud risk score (>= 40).');
    } else {
      if (dto.claimType === 'HEALTH') {
        if (dto.amount <= 1000 && calculatedFraudScore < 20) {
          initialStatus = 'APPROVED';
          calculatedApprovedAmount = Math.max(0, dto.amount - calculatedDeductible);
          auditLogs.push('System auto-approved HEALTH claim under $1000 threshold.');
        } else {
          initialStatus = 'UNDER_REVIEW';
        }
      } else if (dto.claimType === 'AUTO') {
        if (
          dto.amount <= 2000 &&
          calculatedFraudScore < 15 &&
          (dto.customerTier === 'GOLD' || dto.customerTier === 'PLATINUM' || dto.customerTier === 'DIAMOND')
        ) {
          initialStatus = 'APPROVED';
          calculatedApprovedAmount = Math.max(0, dto.amount - calculatedDeductible);
          auditLogs.push('System auto-approved AUTO claim for privileged tier.');
        } else {
          initialStatus = 'UNDER_REVIEW';
        }
      } else if (dto.claimType === 'TRAVEL') {
        if (dto.amount <= 500 && calculatedFraudScore < 10) {
          initialStatus = 'APPROVED';
          calculatedApprovedAmount = Math.max(0, dto.amount - calculatedDeductible);
          auditLogs.push('System auto-approved TRAVEL claim under $500 threshold.');
        } else {
          initialStatus = 'UNDER_REVIEW';
        }
      } else {
        initialStatus = 'UNDER_REVIEW';
      }
    }

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

    if (claim.status === 'PAID' || claim.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot re-evaluate a claim in ${claim.status} status.`);
    }

    if (claim.status === 'APPROVED' && !dto.forceReevaluation) {
      throw new BadRequestException('Approved claim cannot be re-evaluated without forceReevaluation flag.');
    }

    if (dto.additionalFraudFlags && dto.additionalFraudFlags.length > 0) {
      for (let i = 0; i < dto.additionalFraudFlags.length; i++) {
        const flag = dto.additionalFraudFlags[i];
        if (!claim.fraudFlags.includes(flag)) {
          claim.fraudFlags.push(flag);
          claim.auditTrail.push(`Added new fraud flag: ${flag}`);
        }
      }
    }

    if (dto.updatedLineItems && dto.updatedLineItems.length > 0) {
      let newTotal = 0;
      const newItems: LineItem[] = [];
      for (let i = 0; i < dto.updatedLineItems.length; i++) {
        const uItem = dto.updatedLineItems[i];
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
    const daysDiff = (filingDate.getTime() - incidentDate.getTime()) / (1000 * 3600 * 24);

    if (daysDiff > 90) recalculatedScore += 25;
    else if (daysDiff > 30) recalculatedScore += 10;

    for (let i = 0; i < claim.lineItems.length; i++) {
      if (claim.lineItems[i].flagged) {
        recalculatedScore += 15;
      }
    }

    if (claim.customerTier === 'BRONZE' && claim.amount > 10000) {
      recalculatedScore += 20;
    }

    for (let i = 0; i < claim.fraudFlags.length; i++) {
      const flag = claim.fraudFlags[i];
      switch (flag) {
        case 'BLACK_LISTED_IP':
          recalculatedScore += 50;
          break;
        case 'UNLICENSED_PROVIDER':
          recalculatedScore += 40;
          break;
        case 'DUPLICATE_RECEIPT':
          recalculatedScore += 30;
          break;
        case 'HIGH_FREQUENCY_CLAIMS':
          recalculatedScore += 25;
          break;
        case 'RECENT_POLICY_CHANGE':
          recalculatedScore += 20;
          break;
        case 'SUSPICIOUS_LOCATION':
          recalculatedScore += 15;
          break;
      }
    }

    claim.fraudScore = recalculatedScore;

    switch (claim.customerTier) {
      case 'BRONZE':
        claim.deductible = Math.max(500, claim.amount * 0.20);
        break;
      case 'SILVER':
        claim.deductible = Math.max(300, claim.amount * 0.15);
        break;
      case 'GOLD':
        claim.deductible = Math.max(100, claim.amount * 0.10);
        break;
      case 'PLATINUM':
        claim.deductible = claim.amount * 0.05;
        break;
      case 'DIAMOND':
        claim.deductible = 0;
        break;
    }

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
    const claim = this.claimsDb.get(id);
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found.`);
    }

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
      let maxApproveLimit = 0;
      switch (dto.adjusterLevel) {
        case 1:
          maxApproveLimit = 5000;
          break;
        case 2:
          maxApproveLimit = 25000;
          break;
        case 3:
          maxApproveLimit = 100000;
          break;
        case 4:
          maxApproveLimit = Number.MAX_SAFE_INTEGER;
          break;
        default:
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
    const claim = this.claimsDb.get(id);
    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found.`);
    }

    if (claim.status === 'PAID') {
      throw new BadRequestException('Cannot cancel or delete a claim that has already been paid.');
    }

    if (claim.status === 'APPROVED' || claim.status === 'PAYMENT_PENDING') {
      const filingDate = new Date(claim.filingDate);
      const now = new Date();
      const diffDays = (now.getTime() - filingDate.getTime()) / (1000 * 3600 * 24);

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
}
