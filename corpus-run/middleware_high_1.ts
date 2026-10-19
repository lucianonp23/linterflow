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

interface KycEvaluationState {
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

    const state: KycEvaluationState = {
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

    this.evaluateAge(payload, state);
    this.evaluateCountries(payload, state);
    this.evaluateDocuments(payload, state);
    this.evaluateWatchlist(payload, state);
    this.evaluateFinancial(payload, state);

    if (state.isHardBlocked) {
      this.handleHardBlock(state);
    }

    const compositeScore = this.calculateCompositeScore(state);
    const finalStatus = this.determineFinalStatus(compositeScore, state);

    const evaluationResult: KycEvaluationResult = {
      status: finalStatus,
      riskScore: compositeScore,
      reasons: state.reasons,
      requiredActions: state.requiredActions,
      riskBreakdown: {
        countryRisk: state.countryRiskScore,
        documentRisk: state.documentRiskScore,
        watchlistRisk: state.watchlistRiskScore,
        financialRisk: state.financialRiskScore,
        ageRisk: state.ageRiskScore
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
    const rawPayload = this.getRawPayload(req);

    if (!rawPayload) {
      throw new BadRequestException('Missing KYC/AML applicant payload');
    }

    const requiredStringFields = ['applicantId', 'dateOfBirth', 'nationality', 'residenceCountry'];
    for (const field of requiredStringFields) {
      if (!rawPayload[field] || typeof rawPayload[field] !== 'string') {
        throw new BadRequestException(`Missing required field: ${field}`);
      }
    }

    if (typeof rawPayload.monthlyExpectedTurnoverUsd !== 'number') {
      throw new BadRequestException('Missing or invalid field: monthlyExpectedTurnoverUsd');
    }

    return rawPayload as KycApplicantPayload;
  }

  private getRawPayload(req: Request): any {
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

    return rawPayload;
  }

  private evaluateAge(payload: KycApplicantPayload, state: KycEvaluationState): void {
    const age = this.calculateAge(payload.dateOfBirth);
    if (isNaN(age) || age < 0) {
      throw new BadRequestException('Invalid date of birth format');
    }

    if (age < 18) {
      state.isHardBlocked = true;
      state.hardBlockReason = 'Applicant is under legal age of 18';
      return;
    }

    if (age >= 18 && age < 21) {
      this.evaluateYoungApplicant(payload, state);
      return;
    }

    if (age > 75) {
      state.ageRiskScore += 15;
      state.reasons.push('Senior applicant vulnerability check required');
      state.requiredActions.push('VERIFY_BENEFICIAL_OWNERSHIP_INDEPENDENCE');
    }
  }

  private evaluateYoungApplicant(payload: KycApplicantPayload, state: KycEvaluationState): void {
    const isRestrictedArea = payload.residenceCountry === 'US' || payload.residenceCountry === 'SG';
    if (!isRestrictedArea) {
      state.ageRiskScore += 5;
      return;
    }

    if (payload.monthlyExpectedTurnoverUsd > 10000) {
      state.ageRiskScore += 25;
      state.reasons.push('Young applicant in restricted jurisdiction with high transaction volume');
      state.requiredActions.push('REQUIRE_PARENTAL_GUARANTOR_OR_ENHANCED_PROOF_OF_FUNDS');
    } else {
      state.ageRiskScore += 10;
    }
  }

  private evaluateCountries(payload: KycApplicantPayload, state: KycEvaluationState): void {
    const countriesToCheck = [
      payload.nationality,
      payload.residenceCountry,
      payload.secondaryNationality
    ].filter((c): c is string => Boolean(c));

    for (const country of countriesToCheck) {
      this.evaluateSingleCountry(country, state);
    }

    if (payload.nationality !== payload.residenceCountry) {
      this.evaluateCrossBorderMismatch(payload, state);
    }
  }

  private evaluateSingleCountry(country: string, state: KycEvaluationState): void {
    const tier = this.getCountryRiskTier(country);
    switch (tier) {
      case CountryRiskTier.SANCTIONED:
      case CountryRiskTier.FATF_BLACK:
        state.isHardBlocked = true;
        state.hardBlockReason = `Applicant associated with high-risk sanctioned/blacklisted jurisdiction: ${country}`;
        state.countryRiskScore += 100;
        break;

      case CountryRiskTier.FATF_GREY:
        state.countryRiskScore += 45;
        state.reasons.push(`Association with FATF grey-listed jurisdiction: ${country}`);
        state.requiredActions.push('REQUIRE_ENHANCED_DUE_DILIGENCE_FORM');
        break;

      case CountryRiskTier.HIGH:
        state.countryRiskScore += 30;
        state.reasons.push(`Association with high-risk jurisdiction: ${country}`);
        break;

      case CountryRiskTier.MEDIUM:
        state.countryRiskScore += 15;
        break;

      case CountryRiskTier.LOW:
        state.countryRiskScore += 0;
        break;
    }
  }

  private evaluateCrossBorderMismatch(payload: KycApplicantPayload, state: KycEvaluationState): void {
    state.countryRiskScore += 15;
    state.reasons.push('Cross-border nationality and residence mismatch');

    const hasResidencePermit = (payload.documents || []).some(
      (doc) =>
        (doc.type === DocumentType.RESIDENCE_PERMIT || doc.type === DocumentType.NATIONAL_ID) &&
        doc.issuingCountry === payload.residenceCountry
    );

    if (!hasResidencePermit) {
      state.countryRiskScore += 20;
      state.reasons.push('Missing proof of legal residence in current country of residence');
      state.requiredActions.push('SUBMIT_RESIDENCE_PERMIT');
    }
  }

  private evaluateDocuments(payload: KycApplicantPayload, state: KycEvaluationState): void {
    if (!payload.documents || payload.documents.length === 0) {
      state.isHardBlocked = true;
      state.hardBlockReason = 'No compliance identification documents provided';
      return;
    }

    let hasPrimaryId = false;
    let hasProofOfAddress = false;
    const now = new Date();

    for (const doc of payload.documents) {
      if (this.isPrimaryIdType(doc.type)) {
        hasPrimaryId = true;
      }
      if (this.isProofOfAddressType(doc.type)) {
        hasProofOfAddress = true;
      }

      if (!this.evaluateDocumentDates(doc, now, state)) {
        continue;
      }

      this.evaluateDocumentQuality(doc, state);
      this.evaluateSpecificDocumentType(doc, payload, now, state);
    }

    this.evaluateMissingDocRequirements(hasPrimaryId, hasProofOfAddress, payload, state);
  }

  private isPrimaryIdType(type: DocumentType): boolean {
    return (
      type === DocumentType.PASSPORT ||
      type === DocumentType.NATIONAL_ID ||
      type === DocumentType.DRIVERS_LICENSE ||
      type === DocumentType.RESIDENCE_PERMIT
    );
  }

  private isProofOfAddressType(type: DocumentType): boolean {
    return (
      type === DocumentType.UTILITY_BILL ||
      type === DocumentType.BANK_STATEMENT ||
      type === DocumentType.TAX_DECLARATION
    );
  }

  private evaluateDocumentDates(doc: KycDocument, now: Date, state: KycEvaluationState): boolean {
    const expiry = new Date(doc.expiryDate);
    const issue = new Date(doc.issueDate);

    if (isNaN(expiry.getTime()) || isNaN(issue.getTime())) {
      state.documentRiskScore += 30;
      state.reasons.push(`Invalid dates in document ${doc.type}`);
      return false;
    }

    if (expiry.getTime() <= now.getTime()) {
      state.documentRiskScore += 40;
      state.reasons.push(`Document ${doc.type} (${doc.documentNumber}) is expired`);
      state.requiredActions.push(`RENEW_DOCUMENT_${doc.type}`);
    } else {
      const daysToExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysToExpiry < 30) {
        state.documentRiskScore += 15;
        state.reasons.push(`Document ${doc.type} expires within 30 days`);
      }
    }
    return true;
  }

  private evaluateDocumentQuality(doc: KycDocument, state: KycEvaluationState): void {
    if (doc.qualityScore < 50) {
      state.documentRiskScore += 35;
      state.reasons.push(`Document ${doc.type} image quality score is unacceptable (${doc.qualityScore})`);
      state.requiredActions.push(`REUPLOAD_HIGH_RES_${doc.type}`);
    } else if (doc.qualityScore < 75) {
      state.documentRiskScore += 15;
    }
  }

  private evaluateSpecificDocumentType(
    doc: KycDocument,
    payload: KycApplicantPayload,
    now: Date,
    state: KycEvaluationState
  ): void {
    switch (doc.type) {
      case DocumentType.PASSPORT:
        this.evaluatePassport(doc, state);
        break;

      case DocumentType.NATIONAL_ID:
      case DocumentType.DRIVERS_LICENSE:
        if (doc.faceMatchScore !== undefined && doc.faceMatchScore < 65) {
          state.documentRiskScore += 35;
          state.reasons.push(`Facial match low confidence for ${doc.type}`);
        }
        break;

      case DocumentType.RESIDENCE_PERMIT:
        break;

      case DocumentType.UTILITY_BILL:
      case DocumentType.BANK_STATEMENT:
      case DocumentType.TAX_DECLARATION:
        this.evaluateAddressDocument(doc, payload, now, state);
        break;

      default:
        state.documentRiskScore += 10;
        break;
    }
  }

  private evaluatePassport(doc: KycDocument, state: KycEvaluationState): void {
    if (doc.faceMatchScore !== undefined) {
      if (doc.faceMatchScore < 60) {
        state.documentRiskScore += 50;
        state.reasons.push('Passport biometric facial match failure');
        state.requiredActions.push('PERFORM_LIVE_FACIAL_LIVENESS_VERIFICATION');
      } else if (doc.faceMatchScore < 80) {
        state.documentRiskScore += 20;
      }
    }

    if (doc.mrzCode) {
      if (!this.verifyPassportMrz(doc.mrzCode)) {
        state.documentRiskScore += 45;
        state.reasons.push('Passport MRZ checksum calculation failed');
        state.requiredActions.push('SUBMIT_UNALTERED_ORIGINAL_PASSPORT');
      }
    } else {
      state.documentRiskScore += 15;
      state.reasons.push('Passport MRZ string missing');
    }
  }

  private evaluateAddressDocument(
    doc: KycDocument,
    payload: KycApplicantPayload,
    now: Date,
    state: KycEvaluationState
  ): void {
    const issue = new Date(doc.issueDate);
    const ageInDays = Math.floor((now.getTime() - issue.getTime()) / (1000 * 60 * 60 * 24));
    if (ageInDays > 90) {
      state.documentRiskScore += 30;
      state.reasons.push(`Proof of address document ${doc.type} is older than 90 days (${ageInDays} days)`);
      state.requiredActions.push('SUBMIT_RECENT_UTILITY_BILL_OR_STATEMENT');
    }

    if (doc.extractedAddress) {
      if (doc.extractedAddress.country.toUpperCase() !== payload.residenceCountry.toUpperCase()) {
        state.documentRiskScore += 25;
        state.reasons.push('Address document country mismatch with claimed residence country');
      }
    }
  }

  private evaluateMissingDocRequirements(
    hasPrimaryId: boolean,
    hasProofOfAddress: boolean,
    payload: KycApplicantPayload,
    state: KycEvaluationState
  ): void {
    if (!hasPrimaryId) {
      state.documentRiskScore += 50;
      state.reasons.push('No valid primary identity document (Passport, National ID, Drivers License) provided');
      state.requiredActions.push('SUBMIT_PRIMARY_GOVERNMENT_ID');
    }

    if (!hasProofOfAddress && (state.countryRiskScore > 20 || payload.monthlyExpectedTurnoverUsd > 15000)) {
      state.documentRiskScore += 25;
      state.reasons.push('Proof of address mandatory for this risk profile but missing');
      state.requiredActions.push('SUBMIT_PROOF_OF_ADDRESS');
    }
  }

  private evaluateWatchlist(payload: KycApplicantPayload, state: KycEvaluationState): void {
    if (!payload.watchlistHits || payload.watchlistHits.length === 0) {
      return;
    }

    for (const hit of payload.watchlistHits) {
      this.evaluateWatchlistHit(hit, state);
    }
  }

  private evaluateWatchlistHit(hit: WatchlistEntry, state: KycEvaluationState): void {
    switch (hit.category) {
      case 'SANCTION':
        this.evaluateSanctionHit(hit, state);
        break;

      case 'PEP':
        this.evaluatePepHit(hit, state);
        break;

      case 'CRIMINAL':
        this.evaluateCriminalHit(hit, state);
        break;

      case 'SIP':
      case 'ADVERSE_MEDIA':
        this.evaluateAdverseMediaHit(hit, state);
        break;
    }
  }

  private evaluateSanctionHit(hit: WatchlistEntry, state: KycEvaluationState): void {
    if (hit.matchScore >= 85) {
      state.isHardBlocked = true;
      state.hardBlockReason = `Exact or high-confidence Sanctions list match (${hit.fullName})`;
      state.watchlistRiskScore += 100;
    } else if (hit.matchScore >= 65) {
      state.watchlistRiskScore += 60;
      state.reasons.push(`Potential Sanctions list match: ${hit.fullName} (Score: ${hit.matchScore})`);
      state.requiredActions.push('PERFORM_MANUAL_SANCTION_CLEARANCE');
    }
  }

  private evaluatePepHit(hit: WatchlistEntry, state: KycEvaluationState): void {
    const pepTier = hit.pepTier || PepTier.TIER_3;
    switch (pepTier) {
      case PepTier.TIER_1:
        state.watchlistRiskScore += 70;
        state.reasons.push(`Tier 1 Politically Exposed Person match: ${hit.fullName}`);
        state.requiredActions.push('REQUIRE_SENIOR_MANAGEMENT_APPROVAL', 'VERIFY_SOURCE_OF_WEALTH');
        break;

      case PepTier.TIER_2:
        state.watchlistRiskScore += 50;
        state.reasons.push(`Tier 2 Politically Exposed Person match: ${hit.fullName}`);
        state.requiredActions.push('REQUIRE_COMPLIANCE_OFFICER_APPROVAL');
        break;

      case PepTier.TIER_3:
        state.watchlistRiskScore += 30;
        state.reasons.push(`Tier 3 Politically Exposed Person match: ${hit.fullName}`);
        break;

      case PepTier.TIER_4:
        state.watchlistRiskScore += 15;
        state.reasons.push(`PEP relative/close associate match: ${hit.fullName}`);
        break;

      default:
        state.watchlistRiskScore += 20;
        break;
    }
  }

  private evaluateCriminalHit(hit: WatchlistEntry, state: KycEvaluationState): void {
    if (hit.matchScore >= 80) {
      state.watchlistRiskScore += 80;
      state.reasons.push(`High-confidence criminal registry match: ${hit.fullName}`);
      state.requiredActions.push('PERFORM_ENHANCED_CRIMINAL_BACKGROUND_CHECK');
    } else if (hit.matchScore >= 50) {
      state.watchlistRiskScore += 35;
    }
  }

  private evaluateAdverseMediaHit(hit: WatchlistEntry, state: KycEvaluationState): void {
    if (hit.matchScore >= 70) {
      state.watchlistRiskScore += 25;
      state.reasons.push(`Adverse media / Special Interest Person hit: ${hit.fullName}`);
      state.requiredActions.push('REVIEW_ADVERSE_MEDIA_REPORTS');
    }
  }

  private evaluateFinancial(payload: KycApplicantPayload, state: KycEvaluationState): void {
    this.evaluateOccupation(payload, state);
    this.evaluateTurnover(payload, state);
    this.evaluateSourceOfFunds(payload, state);
  }

  private evaluateOccupation(payload: KycApplicantPayload, state: KycEvaluationState): void {
    const occupationRiskLevel = this.assessOccupationRisk(payload.occupation);
    switch (occupationRiskLevel) {
      case OccupationRisk.EXTREME:
        state.financialRiskScore += 40;
        state.reasons.push(`High-risk occupation detected: ${payload.occupation}`);
        state.requiredActions.push('PROVIDE_BUSINESS_LICENSE_AND_TAX_RETURNS');
        break;

      case OccupationRisk.HIGH:
        state.financialRiskScore += 25;
        state.reasons.push(`Elevated risk occupation: ${payload.occupation}`);
        break;

      case OccupationRisk.MEDIUM:
        state.financialRiskScore += 10;
        break;

      case OccupationRisk.LOW:
        state.financialRiskScore += 0;
        break;
    }

    const normalizedOccupation = payload.occupation.toUpperCase();
    if (
      (normalizedOccupation.includes('STUDENT') || normalizedOccupation.includes('UNEMPLOYED')) &&
      payload.monthlyExpectedTurnoverUsd > 10000
    ) {
      state.financialRiskScore += 45;
      state.reasons.push('Declared turnover inconsistent with student/unemployed status');
      state.requiredActions.push('SUBMIT_PROOF_OF_WEALTH_SOURCE');
    }
  }

  private evaluateTurnover(payload: KycApplicantPayload, state: KycEvaluationState): void {
    if (payload.monthlyExpectedTurnoverUsd > 100000) {
      state.financialRiskScore += 30;
      state.reasons.push('High monthly turnover expectation (> $100,000 USD)');
      state.requiredActions.push('SUBMIT_ENHANCED_SOURCE_OF_FUNDS_DOCUMENTATION');
    } else if (payload.monthlyExpectedTurnoverUsd > 50000) {
      state.financialRiskScore += 15;
    }
  }

  private evaluateSourceOfFunds(payload: KycApplicantPayload, state: KycEvaluationState): void {
    const validatedSof = this.validateSourceOfFunds(payload.declaredSourceOfFunds);
    if (!validatedSof.valid) {
      state.financialRiskScore += 20;
      state.reasons.push(`Suspicious or vague source of funds: ${payload.declaredSourceOfFunds}`);
    }
  }

  private calculateCompositeScore(state: KycEvaluationState): number {
    return Math.min(
      100,
      Math.round(
        state.countryRiskScore * 0.25 +
        state.documentRiskScore * 0.25 +
        state.watchlistRiskScore * 0.25 +
        state.financialRiskScore * 0.15 +
        state.ageRiskScore * 0.10
      )
    );
  }

  private handleHardBlock(state: KycEvaluationState): never {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'KYC/AML Compliance Check Failed: Account Blocked',
      reason: state.hardBlockReason,
      evaluation: {
        status: 'REJECTED',
        riskScore: 100,
        reasons: [state.hardBlockReason, ...state.reasons],
        requiredActions: ['CONTACT_COMPLIANCE_SUPPORT'],
        riskBreakdown: {
          countryRisk: state.countryRiskScore,
          documentRisk: state.documentRiskScore,
          watchlistRisk: state.watchlistRiskScore,
          financialRisk: state.financialRiskScore,
          ageRisk: state.ageRiskScore
        }
      }
    });
  }

  private determineFinalStatus(
    compositeScore: number,
    state: KycEvaluationState
  ): 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW' | 'REQUIRES_STEP_UP' {
    if (compositeScore >= 75) {
      if (!state.requiredActions.includes('PERFORM_FULL_MANUAL_COMPLIANCE_AUDIT')) {
        state.requiredActions.push('PERFORM_FULL_MANUAL_COMPLIANCE_AUDIT');
      }
      return 'MANUAL_REVIEW';
    }

    if (compositeScore >= 45 || state.requiredActions.length > 0) {
      return 'REQUIRES_STEP_UP';
    }

    return 'APPROVED';
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