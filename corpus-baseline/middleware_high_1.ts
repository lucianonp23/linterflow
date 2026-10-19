import { Injectable, NestMiddleware, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export enum DocumentType {
  PASSPORT = 'PASSPORT',
  NATIONAL_ID = 'NATIONAL_ID',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  RESIDENCE_PERMIT = 'RESIDENCE_PERMIT',
  UTILITY_BILL = 'UTILITY_BILL',
  TAX_DECLARATION = 'TAX_DECLARATION',
  BANK_STATEMENT = 'BANK_STATEMENT'
}

export enum CountryRiskTier {
  FATF_BLACK = 'FATF_BLACK',
  SANCTIONED = 'SANCTIONED',
  FATF_GREY = 'FATF_GREY',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export enum PepTier {
  TIER_1 = 'TIER_1',
  TIER_2 = 'TIER_2',
  TIER_3 = 'TIER_3',
  TIER_4 = 'TIER_4',
  NONE = 'NONE'
}

export enum OccupationRisk {
  EXTREME = 'EXTREME',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export interface KycDocument {
  type: DocumentType;
  documentNumber: string;
  issuingCountry: string;
  issueDate: string;
  expiryDate: string;
  mrzCode?: string;
  qualityScore: number;
  faceMatchScore?: number;
  extractedAddress?: {
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
}

export interface WatchlistEntry {
  id: string;
  category: 'SANCTION' | 'PEP' | 'CRIMINAL' | 'SIP' | 'ADVERSE_MEDIA';
  fullName: string;
  aliases: string[];
  matchScore: number;
  matchType: 'EXACT' | 'PHONETIC' | 'FUZZY';
  pepTier?: PepTier;
}

export interface KycApplicantPayload {
  applicantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  residenceCountry: string;
  secondaryNationality?: string;
  occupation: string;
  monthlyExpectedTurnoverUsd: number;
  declaredSourceOfFunds: string;
  documents: KycDocument[];
  watchlistHits?: WatchlistEntry[];
  ipAddress?: string;
  deviceFingerprint?: string;
}

export interface KycEvaluationResult {
  status: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW' | 'REQUIRES_STEP_UP';
  riskScore: number;
  reasons: string[];
  requiredActions: string[];
  riskBreakdown: {
    countryRisk: number;
    documentRisk: number;
    watchlistRisk: number;
    financialRisk: number;
    ageRisk: number;
  };
}

interface EvaluationContext {
  reasons: string[];
  requiredActions: string[];
  countryRiskScore: number;
  documentRiskScore: number;
  watchlistRiskScore: number;
  financialRiskScore: number;
  ageRiskScore: number;
  isHardBlocked: boolean;
  hardBlockReason: string;
}

@Injectable()
export class KycAmlComplianceMiddleware implements NestMiddleware {
  private readonly blacklistedCountries = new Set(['IR', 'KP', 'SY', 'CU', 'VE', 'MM']);
  private readonly greyListedCountries = new Set(['KH', 'LA', 'YE', 'SD', 'SS', 'ET', 'PK', 'NG', 'TZ', 'MZ']);
  private readonly highRiskCountries = new Set(['RU', 'BY', 'AF', 'IQ', 'LY', 'SO', 'ZW', 'HT', 'NI', 'UA-CRIMEA']);
  private readonly mediumRiskCountries = new Set(['MX', 'BR', 'IN', 'TR', 'ZA', 'PH', 'CO', 'EG', 'KE', 'VN']);

  public use(req: Request, res: Response, next: NextFunction): void {
    const payload = this.extractAndValidatePayload(req);
    const ctx: EvaluationContext = {
      reasons: [],
      requiredActions: [],
      countryRiskScore: 0,
      documentRiskScore: 0,
      watchlistRiskScore: 0,
      financialRiskScore: 0,
      ageRiskScore: 0,
      isHardBlocked: false,
      hardBlockReason: ''
    };

    this.evaluateAgeRisk(payload, ctx);
    this.evaluateCountryRisk(payload, ctx);
    this.evaluateDocumentRisk(payload, ctx);
    this.evaluateWatchlistRisk(payload, ctx);
    this.evaluateFinancialRisk(payload, ctx);

    const compositeScore = Math.min(
      100,
      Math.round(
        ctx.countryRiskScore * 0.25 +
        ctx.documentRiskScore * 0.25 +
        ctx.watchlistRiskScore * 0.25 +
        ctx.financialRiskScore * 0.15 +
        ctx.ageRiskScore * 0.10
      )
    );

    if (ctx.isHardBlocked) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'KYC/AML Compliance Check Failed: Account Blocked',
        reason: ctx.hardBlockReason,
        evaluation: {
          status: 'REJECTED',
          riskScore: 100,
          reasons: [ctx.hardBlockReason, ...ctx.reasons],
          requiredActions: ['CONTACT_COMPLIANCE_SUPPORT'],
          riskBreakdown: {
            countryRisk: ctx.countryRiskScore,
            documentRisk: ctx.documentRiskScore,
            watchlistRisk: ctx.watchlistRiskScore,
            financialRisk: ctx.financialRiskScore,
            ageRisk: ctx.ageRiskScore
          }
        }
      });
    }

    let finalStatus: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW' | 'REQUIRES_STEP_UP';

    if (compositeScore >= 75) {
      finalStatus = 'MANUAL_REVIEW';
      if (!ctx.requiredActions.includes('PERFORM_FULL_MANUAL_COMPLIANCE_AUDIT')) {
        ctx.requiredActions.push('PERFORM_FULL_MANUAL_COMPLIANCE_AUDIT');
      }
    } else if (compositeScore >= 45 || ctx.requiredActions.length > 0) {
      finalStatus = 'REQUIRES_STEP_UP';
    } else {
      finalStatus = 'APPROVED';
    }

    const evaluationResult: KycEvaluationResult = {
      status: finalStatus,
      riskScore: compositeScore,
      reasons: ctx.reasons,
      requiredActions: ctx.requiredActions,
      riskBreakdown: {
        countryRisk: ctx.countryRiskScore,
        documentRisk: ctx.documentRiskScore,
        watchlistRisk: ctx.watchlistRiskScore,
        financialRisk: ctx.financialRiskScore,
        ageRisk: ctx.ageRiskScore
      }
    };

    (req as any).kycEvaluation = evaluationResult;

    if (finalStatus === 'MANUAL_REVIEW' && req.headers['x-enforce-strict-compliance'] === 'true') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'KYC Verification Pending Manual Compliance Review',
        evaluation: evaluationResult
      });
    }

    next();
  }

  private extractAndValidatePayload(req: Request): KycApplicantPayload {
    let rawPayload = req.body;

    if (!rawPayload || Object.keys(rawPayload).length === 0) {
      const headerData = req.headers['x-kyc-payload'];
      if (typeof headerData === 'string') {
        try {
          rawPayload = JSON.parse(headerData);
        } catch {
          throw new BadRequestException('Malformed JSON in x-kyc-payload header');
        }
      }
    }

    if (!rawPayload) {
      throw new BadRequestException('Missing KYC/AML applicant payload');
    }

    if (!rawPayload.applicantId || typeof rawPayload.applicantId !== 'string') {
      throw new BadRequestException('Missing required field: applicantId');
    }
    if (!rawPayload.dateOfBirth || typeof rawPayload.dateOfBirth !== 'string') {
      throw new BadRequestException('Missing required field: dateOfBirth');
    }
    if (!rawPayload.nationality || typeof rawPayload.nationality !== 'string') {
      throw new BadRequestException('Missing required field: nationality');
    }
    if (!rawPayload.residenceCountry || typeof rawPayload.residenceCountry !== 'string') {
      throw new BadRequestException('Missing required field: residenceCountry');
    }
    if (typeof rawPayload.monthlyExpectedTurnoverUsd !== 'number') {
      throw new BadRequestException('Missing or invalid field: monthlyExpectedTurnoverUsd');
    }

    return rawPayload as KycApplicantPayload;
  }

  private evaluateAgeRisk(payload: KycApplicantPayload, ctx: EvaluationContext): void {
    const age = this.calculateAge(payload.dateOfBirth);
    if (isNaN(age) || age < 0) {
      throw new BadRequestException('Invalid date of birth format');
    }

    if (age < 18) {
      ctx.isHardBlocked = true;
      ctx.hardBlockReason = 'Applicant is under legal age of 18';
    } else if (age >= 18 && age < 21) {
      if (payload.residenceCountry === 'US' || payload.residenceCountry === 'SG') {
        if (payload.monthlyExpectedTurnoverUsd > 10000) {
          ctx.ageRiskScore += 25;
          ctx.reasons.push('Young applicant in restricted jurisdiction with high transaction volume');
          ctx.requiredActions.push('REQUIRE_PARENTAL_GUARANTOR_OR_ENHANCED_PROOF_OF_FUNDS');
        } else {
          ctx.ageRiskScore += 10;
        }
      } else {
        ctx.ageRiskScore += 5;
      }
    } else if (age > 75) {
      ctx.ageRiskScore += 15;
      ctx.reasons.push('Senior applicant vulnerability check required');
      ctx.requiredActions.push('VERIFY_BENEFICIAL_OWNERSHIP_INDEPENDENCE');
    }
  }

  private evaluateCountryRisk(payload: KycApplicantPayload, ctx: EvaluationContext): void {
    const countriesToCheck = [
      payload.nationality,
      payload.residenceCountry,
      payload.secondaryNationality
    ].filter((c): c is string => Boolean(c));

    for (const country of countriesToCheck) {
      const tier = this.getCountryRiskTier(country);
      switch (tier) {
        case CountryRiskTier.SANCTIONED:
        case CountryRiskTier.FATF_BLACK:
          ctx.isHardBlocked = true;
          ctx.hardBlockReason = `Applicant associated with high-risk sanctioned/blacklisted jurisdiction: ${country}`;
          ctx.countryRiskScore += 100;
          break;

        case CountryRiskTier.FATF_GREY:
          ctx.countryRiskScore += 45;
          ctx.reasons.push(`Association with FATF grey-listed jurisdiction: ${country}`);
          ctx.requiredActions.push('REQUIRE_ENHANCED_DUE_DILIGENCE_FORM');
          break;

        case CountryRiskTier.HIGH:
          ctx.countryRiskScore += 30;
          ctx.reasons.push(`Association with high-risk jurisdiction: ${country}`);
          break;

        case CountryRiskTier.MEDIUM:
          ctx.countryRiskScore += 15;
          break;

        case CountryRiskTier.LOW:
          ctx.countryRiskScore += 0;
          break;
      }
    }

    if (payload.nationality !== payload.residenceCountry) {
      ctx.countryRiskScore += 15;
      ctx.reasons.push('Cross-border nationality and residence mismatch');

      let hasResidencePermit = false;
      if (payload.documents && payload.documents.length > 0) {
        for (const doc of payload.documents) {
          if (doc.type === DocumentType.RESIDENCE_PERMIT || doc.type === DocumentType.NATIONAL_ID) {
            if (doc.issuingCountry === payload.residenceCountry) {
              hasResidencePermit = true;
              break;
            }
          }
        }
      }
      if (!hasResidencePermit) {
        ctx.countryRiskScore += 20;
        ctx.reasons.push('Missing proof of legal residence in current country of residence');
        ctx.requiredActions.push('SUBMIT_RESIDENCE_PERMIT');
      }
    }
  }

  private evaluateDocumentRisk(payload: KycApplicantPayload, ctx: EvaluationContext): void {
    if (!payload.documents || payload.documents.length === 0) {
      ctx.isHardBlocked = true;
      ctx.hardBlockReason = 'No compliance identification documents provided';
      return;
    }

    let hasPrimaryId = false;
    let hasProofOfAddress = false;
    const now = new Date();

    for (const doc of payload.documents) {
      const expiry = new Date(doc.expiryDate);
      const issue = new Date(doc.issueDate);

      if (isNaN(expiry.getTime()) || isNaN(issue.getTime())) {
        ctx.documentRiskScore += 30;
        ctx.reasons.push(`Invalid dates in document ${doc.type}`);
        continue;
      }

      if (expiry.getTime() <= now.getTime()) {
        ctx.documentRiskScore += 40;
        ctx.reasons.push(`Document ${doc.type} (${doc.documentNumber}) is expired`);
        ctx.requiredActions.push(`RENEW_DOCUMENT_${doc.type}`);
      } else {
        const daysToExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysToExpiry < 30) {
          ctx.documentRiskScore += 15;
          ctx.reasons.push(`Document ${doc.type} expires within 30 days`);
        }
      }

      if (doc.qualityScore < 50) {
        ctx.documentRiskScore += 35;
        ctx.reasons.push(`Document ${doc.type} image quality score is unacceptable (${doc.qualityScore})`);
        ctx.requiredActions.push(`REUPLOAD_HIGH_RES_${doc.type}`);
      } else if (doc.qualityScore < 75) {
        ctx.documentRiskScore += 15;
      }

      switch (doc.type) {
        case DocumentType.PASSPORT:
          hasPrimaryId = true;
          if (doc.faceMatchScore !== undefined) {
            if (doc.faceMatchScore < 60) {
              ctx.documentRiskScore += 50;
              ctx.reasons.push('Passport biometric facial match failure');
              ctx.requiredActions.push('PERFORM_LIVE_FACIAL_LIVENESS_VERIFICATION');
            } else if (doc.faceMatchScore < 80) {
              ctx.documentRiskScore += 20;
            }
          }
          if (doc.mrzCode) {
            if (!this.verifyPassportMrz(doc.mrzCode)) {
              ctx.documentRiskScore += 45;
              ctx.reasons.push('Passport MRZ checksum calculation failed');
              ctx.requiredActions.push('SUBMIT_UNALTERED_ORIGINAL_PASSPORT');
            }
          } else {
            ctx.documentRiskScore += 15;
            ctx.reasons.push('Passport MRZ string missing');
          }
          break;

        case DocumentType.NATIONAL_ID:
        case DocumentType.DRIVERS_LICENSE:
          hasPrimaryId = true;
          if (doc.faceMatchScore !== undefined && doc.faceMatchScore < 65) {
            ctx.documentRiskScore += 35;
            ctx.reasons.push(`Facial match low confidence for ${doc.type}`);
          }
          break;

        case DocumentType.RESIDENCE_PERMIT:
          hasPrimaryId = true;
          break;

        case DocumentType.UTILITY_BILL:
        case DocumentType.BANK_STATEMENT:
        case DocumentType.TAX_DECLARATION:
          hasProofOfAddress = true;
          const ageInDays = Math.floor((now.getTime() - issue.getTime()) / (1000 * 60 * 60 * 24));
          if (ageInDays > 90) {
            ctx.documentRiskScore += 30;
            ctx.reasons.push(`Proof of address document ${doc.type} is older than 90 days (${ageInDays} days)`);
            ctx.requiredActions.push('SUBMIT_RECENT_UTILITY_BILL_OR_STATEMENT');
          }
          if (doc.extractedAddress) {
            if (
              doc.extractedAddress.country.toUpperCase() !== payload.residenceCountry.toUpperCase()
            ) {
              ctx.documentRiskScore += 25;
              ctx.reasons.push('Address document country mismatch with claimed residence country');
            }
          }
          break;

        default:
          ctx.documentRiskScore += 10;
          break;
      }
    }

    if (!hasPrimaryId) {
      ctx.documentRiskScore += 50;
      ctx.reasons.push('No valid primary identity document (Passport, National ID, Drivers License) provided');
      ctx.requiredActions.push('SUBMIT_PRIMARY_GOVERNMENT_ID');
    }

    if (!hasProofOfAddress && (ctx.countryRiskScore > 20 || payload.monthlyExpectedTurnoverUsd > 15000)) {
      ctx.documentRiskScore += 25;
      ctx.reasons.push('Proof of address mandatory for this risk profile but missing');
      ctx.requiredActions.push('SUBMIT_PROOF_OF_ADDRESS');
    }
  }

  private evaluateWatchlistRisk(payload: KycApplicantPayload, ctx: EvaluationContext): void {
    if (!payload.watchlistHits || payload.watchlistHits.length === 0) {
      return;
    }

    for (const hit of payload.watchlistHits) {
      switch (hit.category) {
        case 'SANCTION':
          if (hit.matchScore >= 85) {
            ctx.isHardBlocked = true;
            ctx.hardBlockReason = `Exact or high-confidence Sanctions list match (${hit.fullName})`;
            ctx.watchlistRiskScore += 100;
          } else if (hit.matchScore >= 65) {
            ctx.watchlistRiskScore += 60;
            ctx.reasons.push(`Potential Sanctions list match: ${hit.fullName} (Score: ${hit.matchScore})`);
            ctx.requiredActions.push('PERFORM_MANUAL_SANCTION_CLEARANCE');
          }
          break;

        case 'PEP':
          const pepTier = hit.pepTier || PepTier.TIER_3;
          switch (pepTier) {
            case PepTier.TIER_1:
              ctx.watchlistRiskScore += 70;
              ctx.reasons.push(`Tier 1 Politically Exposed Person match: ${hit.fullName}`);
              ctx.requiredActions.push('REQUIRE_SENIOR_MANAGEMENT_APPROVAL');
              ctx.requiredActions.push('VERIFY_SOURCE_OF_WEALTH');
              break;

            case PepTier.TIER_2:
              ctx.watchlistRiskScore += 50;
              ctx.reasons.push(`Tier 2 Politically Exposed Person match: ${hit.fullName}`);
              ctx.requiredActions.push('REQUIRE_COMPLIANCE_OFFICER_APPROVAL');
              break;

            case PepTier.TIER_3:
              ctx.watchlistRiskScore += 30;
              ctx.reasons.push(`Tier 3 Politically Exposed Person match: ${hit.fullName}`);
              break;

            case PepTier.TIER_4:
              ctx.watchlistRiskScore += 15;
              ctx.reasons.push(`PEP relative/close associate match: ${hit.fullName}`);
              break;

            default:
              ctx.watchlistRiskScore += 20;
              break;
          }
          break;

        case 'CRIMINAL':
          if (hit.matchScore >= 80) {
            ctx.watchlistRiskScore += 80;
            ctx.reasons.push(`High-confidence criminal registry match: ${hit.fullName}`);
            ctx.requiredActions.push('PERFORM_ENHANCED_CRIMINAL_BACKGROUND_CHECK');
          } else if (hit.matchScore >= 50) {
            ctx.watchlistRiskScore += 35;
          }
          break;

        case 'SIP':
        case 'ADVERSE_MEDIA':
          if (hit.matchScore >= 70) {
            ctx.watchlistRiskScore += 25;
            ctx.reasons.push(`Adverse media / Special Interest Person hit: ${hit.fullName}`);
            ctx.requiredActions.push('REVIEW_ADVERSE_MEDIA_REPORTS');
          }
          break;
      }
    }
  }

  private evaluateFinancialRisk(payload: KycApplicantPayload, ctx: EvaluationContext): void {
    const occupationRiskLevel = this.assessOccupationRisk(payload.occupation);
    switch (occupationRiskLevel) {
      case OccupationRisk.EXTREME:
        ctx.financialRiskScore += 40;
        ctx.reasons.push(`High-risk occupation detected: ${payload.occupation}`);
        ctx.requiredActions.push('PROVIDE_BUSINESS_LICENSE_AND_TAX_RETURNS');
        break;

      case OccupationRisk.HIGH:
        ctx.financialRiskScore += 25;
        ctx.reasons.push(`Elevated risk occupation: ${payload.occupation}`);
        break;

      case OccupationRisk.MEDIUM:
        ctx.financialRiskScore += 10;
        break;

      case OccupationRisk.LOW:
        ctx.financialRiskScore += 0;
        break;
    }

    const normalizedOccupation = payload.occupation.toUpperCase();
    if (
      (normalizedOccupation.includes('STUDENT') || normalizedOccupation.includes('UNEMPLOYED')) &&
      payload.monthlyExpectedTurnoverUsd > 10000
    ) {
      ctx.financialRiskScore += 45;
      ctx.reasons.push('Declared turnover inconsistent with student/unemployed status');
      ctx.requiredActions.push('SUBMIT_PROOF_OF_WEALTH_SOURCE');
    }

    if (payload.monthlyExpectedTurnoverUsd > 100000) {
      ctx.financialRiskScore += 30;
      ctx.reasons.push('High monthly turnover expectation (> $100,000 USD)');
      ctx.requiredActions.push('SUBMIT_ENHANCED_SOURCE_OF_FUNDS_DOCUMENTATION');
    } else if (payload.monthlyExpectedTurnoverUsd > 50000) {
      ctx.financialRiskScore += 15;
    }

    const validatedSof = this.validateSourceOfFunds(payload.declaredSourceOfFunds);
    if (!validatedSof.valid) {
      ctx.financialRiskScore += 20;
      ctx.reasons.push(`Suspicious or vague source of funds: ${payload.declaredSourceOfFunds}`);
    }
  }

  private calculateAge(dobString: string): number {
    const dob = new Date(dobString);
    if (isNaN(dob.getTime())) {
      return -1;
    }
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  }

  private getCountryRiskTier(countryCode: string): CountryRiskTier {
    const code = countryCode.toUpperCase();
    if (this.blacklistedCountries.has(code)) {
      return CountryRiskTier.FATF_BLACK;
    }
    if (this.greyListedCountries.has(code)) {
      return CountryRiskTier.FATF_GREY;
    }
    if (this.highRiskCountries.has(code)) {
      return CountryRiskTier.HIGH;
    }
    if (this.mediumRiskCountries.has(code)) {
      return CountryRiskTier.MEDIUM;
    }
    return CountryRiskTier.LOW;
  }

  private assessOccupationRisk(occupation: string): OccupationRisk {
    const normalized = occupation.toUpperCase();
    const extremeTerms = ['CRYPTO', 'GAMBLING', 'CASINO', 'ARMS', 'DEFENSE', 'MONEY_SERVICE', 'FOREX', 'HAWALA'];
    const highTerms = ['REAL_ESTATE', 'PRECIOUS_METALS', 'PAWN', 'ART_DEALER', 'CAR_DEALER', 'POLITICIAN', 'EMBASSY'];
    const mediumTerms = ['CONSTRUCTION', 'WHOLESALE', 'RETAIL', 'FREELANCE', 'CONSULTANT', 'IMPORT_EXPORT'];

    for (const term of extremeTerms) {
      if (normalized.includes(term)) {
        return OccupationRisk.EXTREME;
      }
    }
    for (const term of highTerms) {
      if (normalized.includes(term)) {
        return OccupationRisk.HIGH;
      }
    }
    for (const term of mediumTerms) {
      if (normalized.includes(term)) {
        return OccupationRisk.MEDIUM;
      }
    }
    return OccupationRisk.LOW;
  }

  private validateSourceOfFunds(sof: string): { valid: boolean; score: number } {
    if (!sof || sof.trim().length < 3) {
      return { valid: false, score: 0 };
    }
    const normalized = sof.toUpperCase();
    const suspiciousTerms = ['GIFT', 'LOAN_FROM_FRIEND', 'UNKNOWN', 'CASH_SAVINGS', 'CRYPTO_AIRDROP', 'FOUND'];

    for (const term of suspiciousTerms) {
      if (normalized.includes(term)) {
        return { valid: false, score: 20 };
      }
    }

    const validTerms = ['SALARY', 'SAVINGS', 'INVESTMENT', 'INHERITANCE', 'COMPANY_PROFITS', 'REAL_ESTATE_SALE'];
    for (const term of validTerms) {
      if (normalized.includes(term)) {
        return { valid: true, score: 100 };
      }
    }

    return { valid: true, score: 50 };
  }

  private verifyPassportMrz(mrz: string): boolean {
    const cleaned = mrz.replace(/[\r\n\s]+/g, '').toUpperCase();
    if (cleaned.length !== 88 && cleaned.length !== 90 && cleaned.length !== 72) {
      return false;
    }

    const weightSequence = [7, 3, 1];
    const getCharValue = (char: string): number => {
      if (char === '<') return 0;
      if (char >= '0' && char <= '9') return char.charCodeAt(0) - '0'.charCodeAt(0);
      if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      return 0;
    };

    const computeChecksum = (str: string): number => {
      let sum = 0;
      for (let i = 0; i < str.length; i++) {
        const val = getCharValue(str[i]);
        const weight = weightSequence[i % 3];
        sum += val * weight;
      }
      return sum % 10;
    };

    if (cleaned.length === 88) {
      const line2 = cleaned.substring(44);
      const passportNum = line2.substring(0, 9);
      const passportCheck = getCharValue(line2[9]);
      const dob = line2.substring(13, 19);
      const dobCheck = getCharValue(line2[19]);
      const expiry = line2.substring(21, 27);
      const expiryCheck = getCharValue(line2[27]);

      if (computeChecksum(passportNum) !== passportCheck) return false;
      if (computeChecksum(dob) !== dobCheck) return false;
      if (computeChecksum(expiry) !== expiryCheck) return false;
    }

    return true;
  }
}