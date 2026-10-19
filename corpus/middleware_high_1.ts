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

@Injectable()
export class KycAmlComplianceMiddleware implements NestMiddleware {
  private readonly blacklistedCountries = new Set(['IR', 'KP', 'SY', 'CU', 'VE', 'MM']);
  private readonly greyListedCountries = new Set(['KH', 'LA', 'YE', 'SD', 'SS', 'ET', 'PK', 'NG', 'TZ', 'MZ']);
  private readonly highRiskCountries = new Set(['RU', 'BY', 'AF', 'IQ', 'LY', 'SO', 'ZW', 'HT', 'NI', 'UA-CRIMEA']);
  private readonly mediumRiskCountries = new Set(['MX', 'BR', 'IN', 'TR', 'ZA', 'PH', 'CO', 'EG', 'KE', 'VN']);

  public use(req: Request, res: Response, next: NextFunction): void {
    const payload = this.extractAndValidatePayload(req);

    const reasons: string[] = [];
    const requiredActions: string[] = [];

    let countryRiskScore = 0;
    let documentRiskScore = 0;
    let watchlistRiskScore = 0;
    let financialRiskScore = 0;
    let ageRiskScore = 0;

    let isHardBlocked = false;
    let hardBlockReason = '';

    const age = this.calculateAge(payload.dateOfBirth);
    if (isNaN(age) || age < 0) {
      throw new BadRequestException('Invalid date of birth format');
    }

    if (age < 18) {
      isHardBlocked = true;
      hardBlockReason = 'Applicant is under legal age of 18';
    } else if (age >= 18 && age < 21) {
      if (payload.residenceCountry === 'US' || payload.residenceCountry === 'SG') {
        if (payload.monthlyExpectedTurnoverUsd > 10000) {
          ageRiskScore += 25;
          reasons.push('Young applicant in restricted jurisdiction with high transaction volume');
          requiredActions.push('REQUIRE_PARENTAL_GUARANTOR_OR_ENHANCED_PROOF_OF_FUNDS');
        } else {
          ageRiskScore += 10;
        }
      } else {
        ageRiskScore += 5;
      }
    } else if (age > 75) {
      ageRiskScore += 15;
      reasons.push('Senior applicant vulnerability check required');
      requiredActions.push('VERIFY_BENEFICIAL_OWNERSHIP_INDEPENDENCE');
    }

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
          isHardBlocked = true;
          hardBlockReason = `Applicant associated with high-risk sanctioned/blacklisted jurisdiction: ${country}`;
          countryRiskScore += 100;
          break;

        case CountryRiskTier.FATF_GREY:
          countryRiskScore += 45;
          reasons.push(`Association with FATF grey-listed jurisdiction: ${country}`);
          requiredActions.push('REQUIRE_ENHANCED_DUE_DILIGENCE_FORM');
          break;

        case CountryRiskTier.HIGH:
          countryRiskScore += 30;
          reasons.push(`Association with high-risk jurisdiction: ${country}`);
          break;

        case CountryRiskTier.MEDIUM:
          countryRiskScore += 15;
          break;

        case CountryRiskTier.LOW:
          countryRiskScore += 0;
          break;
      }
    }

    if (payload.nationality !== payload.residenceCountry) {
      countryRiskScore += 15;
      reasons.push('Cross-border nationality and residence mismatch');

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
        countryRiskScore += 20;
        reasons.push('Missing proof of legal residence in current country of residence');
        requiredActions.push('SUBMIT_RESIDENCE_PERMIT');
      }
    }

    if (!payload.documents || payload.documents.length === 0) {
      isHardBlocked = true;
      hardBlockReason = 'No compliance identification documents provided';
    } else {
      let hasPrimaryId = false;
      let hasProofOfAddress = false;
      const now = new Date();

      for (const doc of payload.documents) {
        const expiry = new Date(doc.expiryDate);
        const issue = new Date(doc.issueDate);

        if (isNaN(expiry.getTime()) || isNaN(issue.getTime())) {
          documentRiskScore += 30;
          reasons.push(`Invalid dates in document ${doc.type}`);
          continue;
        }

        if (expiry.getTime() <= now.getTime()) {
          documentRiskScore += 40;
          reasons.push(`Document ${doc.type} (${doc.documentNumber}) is expired`);
          requiredActions.push(`RENEW_DOCUMENT_${doc.type}`);
        } else {
          const daysToExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (daysToExpiry < 30) {
            documentRiskScore += 15;
            reasons.push(`Document ${doc.type} expires within 30 days`);
          }
        }

        if (doc.qualityScore < 50) {
          documentRiskScore += 35;
          reasons.push(`Document ${doc.type} image quality score is unacceptable (${doc.qualityScore})`);
          requiredActions.push(`REUPLOAD_HIGH_RES_${doc.type}`);
        } else if (doc.qualityScore < 75) {
          documentRiskScore += 15;
        }

        switch (doc.type) {
          case DocumentType.PASSPORT:
            hasPrimaryId = true;
            if (doc.faceMatchScore !== undefined) {
              if (doc.faceMatchScore < 60) {
                documentRiskScore += 50;
                reasons.push('Passport biometric facial match failure');
                requiredActions.push('PERFORM_LIVE_FACIAL_LIVENESS_VERIFICATION');
              } else if (doc.faceMatchScore < 80) {
                documentRiskScore += 20;
              }
            }
            if (doc.mrzCode) {
              if (!this.verifyPassportMrz(doc.mrzCode)) {
                documentRiskScore += 45;
                reasons.push('Passport MRZ checksum calculation failed');
                requiredActions.push('SUBMIT_UNALTERED_ORIGINAL_PASSPORT');
              }
            } else {
              documentRiskScore += 15;
              reasons.push('Passport MRZ string missing');
            }
            break;

          case DocumentType.NATIONAL_ID:
          case DocumentType.DRIVERS_LICENSE:
            hasPrimaryId = true;
            if (doc.faceMatchScore !== undefined && doc.faceMatchScore < 65) {
              documentRiskScore += 35;
              reasons.push(`Facial match low confidence for ${doc.type}`);
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
              documentRiskScore += 30;
              reasons.push(`Proof of address document ${doc.type} is older than 90 days (${ageInDays} days)`);
              requiredActions.push('SUBMIT_RECENT_UTILITY_BILL_OR_STATEMENT');
            }
            if (doc.extractedAddress) {
              if (
                doc.extractedAddress.country.toUpperCase() !== payload.residenceCountry.toUpperCase()
              ) {
                documentRiskScore += 25;
                reasons.push('Address document country mismatch with claimed residence country');
              }
            }
            break;

          default:
            documentRiskScore += 10;
            break;
        }
      }

      if (!hasPrimaryId) {
        documentRiskScore += 50;
        reasons.push('No valid primary identity document (Passport, National ID, Drivers License) provided');
        requiredActions.push('SUBMIT_PRIMARY_GOVERNMENT_ID');
      }

      if (!hasProofOfAddress && (countryRiskScore > 20 || payload.monthlyExpectedTurnoverUsd > 15000)) {
        documentRiskScore += 25;
        reasons.push('Proof of address mandatory for this risk profile but missing');
        requiredActions.push('SUBMIT_PROOF_OF_ADDRESS');
      }
    }

    if (payload.watchlistHits && payload.watchlistHits.length > 0) {
      for (const hit of payload.watchlistHits) {
        switch (hit.category) {
          case 'SANCTION':
            if (hit.matchScore >= 85) {
              isHardBlocked = true;
              hardBlockReason = `Exact or high-confidence Sanctions list match (${hit.fullName})`;
              watchlistRiskScore += 100;
            } else if (hit.matchScore >= 65) {
              watchlistRiskScore += 60;
              reasons.push(`Potential Sanctions list match: ${hit.fullName} (Score: ${hit.matchScore})`);
              requiredActions.push('PERFORM_MANUAL_SANCTION_CLEARANCE');
            }
            break;

          case 'PEP':
            const pepTier = hit.pepTier || PepTier.TIER_3;
            switch (pepTier) {
              case PepTier.TIER_1:
                watchlistRiskScore += 70;
                reasons.push(`Tier 1 Politically Exposed Person match: ${hit.fullName}`);
                requiredActions.push('REQUIRE_SENIOR_MANAGEMENT_APPROVAL');
                requiredActions.push('VERIFY_SOURCE_OF_WEALTH');
                break;

              case PepTier.TIER_2:
                watchlistRiskScore += 50;
                reasons.push(`Tier 2 Politically Exposed Person match: ${hit.fullName}`);
                requiredActions.push('REQUIRE_COMPLIANCE_OFFICER_APPROVAL');
                break;

              case PepTier.TIER_3:
                watchlistRiskScore += 30;
                reasons.push(`Tier 3 Politically Exposed Person match: ${hit.fullName}`);
                break;

              case PepTier.TIER_4:
                watchlistRiskScore += 15;
                reasons.push(`PEP relative/close associate match: ${hit.fullName}`);
                break;

              default:
                watchlistRiskScore += 20;
                break;
            }
            break;

          case 'CRIMINAL':
            if (hit.matchScore >= 80) {
              watchlistRiskScore += 80;
              reasons.push(`High-confidence criminal registry match: ${hit.fullName}`);
              requiredActions.push('PERFORM_ENHANCED_CRIMINAL_BACKGROUND_CHECK');
            } else if (hit.matchScore >= 50) {
              watchlistRiskScore += 35;
            }
            break;

          case 'SIP':
          case 'ADVERSE_MEDIA':
            if (hit.matchScore >= 70) {
              watchlistRiskScore += 25;
              reasons.push(`Adverse media / Special Interest Person hit: ${hit.fullName}`);
              requiredActions.push('REVIEW_ADVERSE_MEDIA_REPORTS');
            }
            break;
        }
      }
    }

    const occupationRiskLevel = this.assessOccupationRisk(payload.occupation);
    switch (occupationRiskLevel) {
      case OccupationRisk.EXTREME:
        financialRiskScore += 40;
        reasons.push(`High-risk occupation detected: ${payload.occupation}`);
        requiredActions.push('PROVIDE_BUSINESS_LICENSE_AND_TAX_RETURNS');
        break;

      case OccupationRisk.HIGH:
        financialRiskScore += 25;
        reasons.push(`Elevated risk occupation: ${payload.occupation}`);
        break;

      case OccupationRisk.MEDIUM:
        financialRiskScore += 10;
        break;

      case OccupationRisk.LOW:
        financialRiskScore += 0;
        break;
    }

    const normalizedOccupation = payload.occupation.toUpperCase();
    if (
      (normalizedOccupation.includes('STUDENT') || normalizedOccupation.includes('UNEMPLOYED')) &&
      payload.monthlyExpectedTurnoverUsd > 10000
    ) {
      financialRiskScore += 45;
      reasons.push('Declared turnover inconsistent with student/unemployed status');
      requiredActions.push('SUBMIT_PROOF_OF_WEALTH_SOURCE');
    }

    if (payload.monthlyExpectedTurnoverUsd > 100000) {
      financialRiskScore += 30;
      reasons.push('High monthly turnover expectation (> $100,000 USD)');
      requiredActions.push('SUBMIT_ENHANCED_SOURCE_OF_FUNDS_DOCUMENTATION');
    } else if (payload.monthlyExpectedTurnoverUsd > 50000) {
      financialRiskScore += 15;
    }

    const validatedSof = this.validateSourceOfFunds(payload.declaredSourceOfFunds);
    if (!validatedSof.valid) {
      financialRiskScore += 20;
      reasons.push(`Suspicious or vague source of funds: ${payload.declaredSourceOfFunds}`);
    }

    const compositeScore = Math.min(
      100,
      Math.round(
        countryRiskScore * 0.25 +
        documentRiskScore * 0.25 +
        watchlistRiskScore * 0.25 +
        financialRiskScore * 0.15 +
        ageRiskScore * 0.10
      )
    );

    if (isHardBlocked) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'KYC/AML Compliance Check Failed: Account Blocked',
        reason: hardBlockReason,
        evaluation: {
          status: 'REJECTED',
          riskScore: 100,
          reasons: [hardBlockReason, ...reasons],
          requiredActions: ['CONTACT_COMPLIANCE_SUPPORT'],
          riskBreakdown: {
            countryRisk: countryRiskScore,
            documentRisk: documentRiskScore,
            watchlistRisk: watchlistRiskScore,
            financialRisk: financialRiskScore,
            ageRisk: ageRiskScore
          }
        }
      });
    }

    let finalStatus: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW' | 'REQUIRES_STEP_UP';

    if (compositeScore >= 75) {
      finalStatus = 'MANUAL_REVIEW';
      if (!requiredActions.includes('PERFORM_FULL_MANUAL_COMPLIANCE_AUDIT')) {
        requiredActions.push('PERFORM_FULL_MANUAL_COMPLIANCE_AUDIT');
      }
    } else if (compositeScore >= 45 || requiredActions.length > 0) {
      finalStatus = 'REQUIRES_STEP_UP';
    } else {
      finalStatus = 'APPROVED';
    }

    const evaluationResult: KycEvaluationResult = {
      status: finalStatus,
      riskScore: compositeScore,
      reasons,
      requiredActions,
      riskBreakdown: {
        countryRisk: countryRiskScore,
        documentRisk: documentRiskScore,
        watchlistRisk: watchlistRiskScore,
        financialRisk: financialRiskScore,
        ageRisk: ageRiskScore
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
