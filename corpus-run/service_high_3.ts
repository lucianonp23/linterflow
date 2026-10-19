import { Injectable } from '@nestjs/common';

export enum FraudAction {
  APPROVE = 'APPROVE',
  CHALLENGE_MFA = 'CHALLENGE_MFA',
  REVIEW = 'REVIEW',
  REJECT = 'REJECT',
}

export enum ConnectionType {
  RESIDENTIAL = 'RESIDENTIAL',
  CELLULAR = 'CELLULAR',
  VPN = 'VPN',
  PROXY = 'PROXY',
  TOR = 'TOR',
  UNKNOWN = 'UNKNOWN',
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  countryCode: string;
  city?: string;
}

export interface HistoricalTransaction {
  id: string;
  timestamp: number;
  amount: number;
  currency: string;
  location: GeoLocation;
  deviceId: string;
  ipAddress: string;
  merchantCategoryCode: string;
  status: 'SUCCESS' | 'FAILED' | 'REJECTED';
}

export interface DeviceContext {
  deviceId: string;
  ipAddress: string;
  connectionType: ConnectionType;
  isKnownDevice: boolean;
  userAgent: string;
  os: string;
  browser: string;
  language: string;
  isEmulated: boolean;
  hasRootOrJailbreak: boolean;
}

export interface UserContext {
  userId: string;
  accountCreatedTimestamp: number;
  email: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  mfaEnabled: boolean;
  homeCountry: string;
  avgTransactionAmount30Days: number;
  transactionCount30Days: number;
  chargebackHistoryCount: number;
  failedLoginAttempts24h: number;
}

export interface TransactionContext {
  transactionId: string;
  timestamp: number;
  amount: number;
  currency: string;
  merchantCategoryCode: string;
  merchantId: string;
  cardBin: string;
  cardCountry: string;
  location: GeoLocation;
  user: UserContext;
  device: DeviceContext;
  history: HistoricalTransaction[];
  blacklistedIps: string[];
  blacklistedDevices: string[];
  blacklistedCards: string[];
  highRiskCountries: string[];
  disposableEmailDomains: string[];
}

export interface TriggeredSignal {
  ruleId: string;
  description: string;
  scoreImpact: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface FraudEvaluationResult {
  transactionId: string;
  finalScore: number;
  action: FraudAction;
  isAutomatedReject: boolean;
  signals: TriggeredSignal[];
  breakdown: {
    velocityScore: number;
    geoScore: number;
    deviceScore: number;
    amountAnomalyScore: number;
    userRiskScore: number;
    synergyScore: number;
  };
}

@Injectable()
export class FraudDetectionEngineService {
  public evaluateTransaction(context: TransactionContext): FraudEvaluationResult {
    const signals: TriggeredSignal[] = [];

    const isAutomatedReject = this.checkBlacklists(context, signals);
    const sortedHistory = [...context.history].sort((a, b) => b.timestamp - a.timestamp);

    const velocityScore = this.evaluateVelocity(context, sortedHistory, signals);
    const geoScore = this.evaluateGeo(context, sortedHistory, signals);
    const deviceScore = this.evaluateDevice(context, signals);
    
    const { amountAnomalyScore, mccMultiplier } = this.evaluateAmount(context, signals);

    const accountAgeDays = (context.timestamp - context.user.accountCreatedTimestamp) / (1000 * 60 * 60 * 24);
    const userRiskScore = this.evaluateUser(context, accountAgeDays, signals);

    const synergyScore = this.evaluateSynergy(context, accountAgeDays, mccMultiplier, signals);

    const rawScore = velocityScore + geoScore + deviceScore + amountAnomalyScore + userRiskScore + synergyScore;
    let finalScore = Math.min(Math.max(rawScore, 0), 100);

    if (isAutomatedReject) {
      finalScore = 100;
    }

    const action = this.determineAction(finalScore, isAutomatedReject, context.user.mfaEnabled);

    return {
      transactionId: context.transactionId,
      finalScore,
      action,
      isAutomatedReject,
      signals,
      breakdown: {
        velocityScore,
        geoScore,
        deviceScore,
        amountAnomalyScore,
        userRiskScore,
        synergyScore,
      },
    };
  }

  private checkBlacklists(context: TransactionContext, signals: TriggeredSignal[]): boolean {
    let isAutomatedReject = false;

    if (context.blacklistedIps.includes(context.device.ipAddress)) {
      isAutomatedReject = true;
      signals.push({
        ruleId: 'BLK_001',
        description: 'IP Address is explicitly blacklisted',
        scoreImpact: 100,
        severity: 'CRITICAL',
      });
    }

    if (context.blacklistedDevices.includes(context.device.deviceId)) {
      isAutomatedReject = true;
      signals.push({
        ruleId: 'BLK_002',
        description: 'Device ID is explicitly blacklisted',
        scoreImpact: 100,
        severity: 'CRITICAL',
      });
    }

    if (context.blacklistedCards.includes(context.cardBin)) {
      isAutomatedReject = true;
      signals.push({
        ruleId: 'BLK_003',
        description: 'Card BIN/Number is explicitly blacklisted',
        scoreImpact: 100,
        severity: 'CRITICAL',
      });
    }

    return isAutomatedReject;
  }

  private aggregateHistory(context: TransactionContext) {
    const fiveMinsAgo = context.timestamp - 5 * 60 * 1000;
    const oneHourAgo = context.timestamp - 60 * 60 * 1000;
    const twentyFourHoursAgo = context.timestamp - 24 * 60 * 60 * 1000;

    let txCount5m = 0;
    let txSum5m = 0;
    let txCount1h = 0;
    let txSum1h = 0;
    let txCount24h = 0;
    let failedTxCount24h = 0;

    for (let i = 0; i < context.history.length; i++) {
      const tx = context.history[i];
      if (tx.timestamp >= fiveMinsAgo) {
        txCount5m++;
        txSum5m += tx.amount;
      }
      if (tx.timestamp >= oneHourAgo) {
        txCount1h++;
        txSum1h += tx.amount;
      }
      if (tx.timestamp >= twentyFourHoursAgo) {
        txCount24h++;
        if (tx.status === 'FAILED' || tx.status === 'REJECTED') {
          failedTxCount24h++;
        }
      }
    }

    return { txCount5m, txSum5m, txCount1h, txSum1h, txCount24h, failedTxCount24h };
  }

  private evalVelocityFrequency(txCount5m: number, txSum5m: number, txCount1h: number, signals: TriggeredSignal[]): number {
    if (txCount5m >= 3) {
      if (txSum5m > 1000) {
        signals.push({
          ruleId: 'VEL_001',
          description: 'High frequency and high aggregate amount in 5-minute window',
          scoreImpact: 35,
          severity: 'HIGH',
        });
        return 35;
      }
      signals.push({
        ruleId: 'VEL_002',
        description: 'High frequency transactions in 5-minute window',
        scoreImpact: 20,
        severity: 'MEDIUM',
      });
      return 20;
    }

    if (txCount1h >= 8) {
      signals.push({
        ruleId: 'VEL_003',
        description: 'Exceeded hourly transaction frequency threshold',
        scoreImpact: 25,
        severity: 'MEDIUM',
      });
      return 25;
    }

    return 0;
  }

  private evalVelocityFailed(failedTxCount24h: number, signals: TriggeredSignal[]): number {
    if (failedTxCount24h >= 3) {
      if (failedTxCount24h >= 6) {
        signals.push({
          ruleId: 'VEL_004',
          description: 'Excessive failed transactions in last 24 hours',
          scoreImpact: 30,
          severity: 'HIGH',
        });
        return 30;
      }
      signals.push({
        ruleId: 'VEL_005',
        description: 'Multiple failed transactions in last 24 hours',
        scoreImpact: 15,
        severity: 'MEDIUM',
      });
      return 15;
    }
    return 0;
  }

  private evalVelocityCardTesting(context: TransactionContext, sortedHistory: HistoricalTransaction[], signals: TriggeredSignal[]): number {
    let lowAmountCount = 0;
    for (let i = 0; i < sortedHistory.length; i++) {
      const pastTx = sortedHistory[i];
      if (context.timestamp - pastTx.timestamp <= 15 * 60 * 1000) {
        if (pastTx.amount > 0 && pastTx.amount <= 5.0) {
          lowAmountCount++;
        }
      } else {
        break;
      }
    }

    if (lowAmountCount >= 3 && context.amount > 100) {
      signals.push({
        ruleId: 'VEL_006',
        description: 'Potential card testing pattern detected (small rapid micro-transactions followed by large purchase)',
        scoreImpact: 40,
        severity: 'CRITICAL',
      });
      return 40;
    }
    return 0;
  }

  private evaluateVelocity(context: TransactionContext, sortedHistory: HistoricalTransaction[], signals: TriggeredSignal[]): number {
    const agg = this.aggregateHistory(context);
    let score = 0;
    score += this.evalVelocityFrequency(agg.txCount5m, agg.txSum5m, agg.txCount1h, signals);
    score += this.evalVelocityFailed(agg.failedTxCount24h, signals);
    score += this.evalVelocityCardTesting(context, sortedHistory, signals);
    return score;
  }

  private evalGeoTravel(context: TransactionContext, sortedHistory: HistoricalTransaction[], signals: TriggeredSignal[]): number {
    if (sortedHistory.length === 0) {
      return 0;
    }

    const lastTx = sortedHistory[0];
    const distanceKm = this.calculateHaversineDistance(
      context.location.latitude,
      context.location.longitude,
      lastTx.location.latitude,
      lastTx.location.longitude,
    );
    const timeDeltaHours = (context.timestamp - lastTx.timestamp) / (1000 * 60 * 60);

    if (timeDeltaHours <= 0) {
      return 0;
    }

    const speedKmH = distanceKm / timeDeltaHours;
    if (speedKmH > 900 && distanceKm > 300) {
      if (context.amount > 500) {
        signals.push({
          ruleId: 'GEO_001',
          description: 'Impossible travel velocity detected with high-value transaction',
          scoreImpact: 45,
          severity: 'CRITICAL',
        });
        return 45;
      }
      signals.push({
        ruleId: 'GEO_002',
        description: 'Impossible travel velocity detected',
        scoreImpact: 30,
        severity: 'HIGH',
      });
      return 30;
    }

    if (speedKmH > 500 && distanceKm > 200) {
      signals.push({
        ruleId: 'GEO_003',
        description: 'Unusually high physical travel velocity',
        scoreImpact: 15,
        severity: 'MEDIUM',
      });
      return 15;
    }

    return 0;
  }

  private evalGeoJurisdiction(context: TransactionContext, signals: TriggeredSignal[]): number {
    let score = 0;

    if (context.highRiskCountries.includes(context.location.countryCode)) {
      score += 25;
      signals.push({
        ruleId: 'GEO_004',
        description: 'Transaction originated from high-risk jurisdiction',
        scoreImpact: 25,
        severity: 'HIGH',
      });
    }

    if (
      context.user.homeCountry &&
      context.location.countryCode !== context.user.homeCountry &&
      context.location.countryCode !== context.cardCountry
    ) {
      score += 20;
      signals.push({
        ruleId: 'GEO_005',
        description: 'Mismatched transaction location relative to user home country and card issuing country',
        scoreImpact: 20,
        severity: 'MEDIUM',
      });
    }

    return score;
  }

  private evaluateGeo(context: TransactionContext, sortedHistory: HistoricalTransaction[], signals: TriggeredSignal[]): number {
    return this.evalGeoTravel(context, sortedHistory, signals) + this.evalGeoJurisdiction(context, signals);
  }

  private evalDeviceConnection(context: TransactionContext, signals: TriggeredSignal[]): number {
    switch (context.device.connectionType) {
      case ConnectionType.TOR:
        signals.push({
          ruleId: 'DEV_001',
          description: 'Connection routed through TOR anonymizing network',
          scoreImpact: 40,
          severity: 'CRITICAL',
        });
        return 40;
      case ConnectionType.PROXY:
        signals.push({
          ruleId: 'DEV_002',
          description: 'Connection routed through proxy server',
          scoreImpact: 25,
          severity: 'HIGH',
        });
        return 25;
      case ConnectionType.VPN:
        if (!context.device.isKnownDevice) {
          signals.push({
            ruleId: 'DEV_003',
            description: 'VPN detected on an unrecognized device',
            scoreImpact: 20,
            severity: 'MEDIUM',
          });
          return 20;
        }
        signals.push({
          ruleId: 'DEV_004',
          description: 'VPN detected on a known user device',
          scoreImpact: 5,
          severity: 'LOW',
        });
        return 5;
      case ConnectionType.CELLULAR:
      case ConnectionType.RESIDENTIAL:
        return 0;
      default:
        signals.push({
          ruleId: 'DEV_005',
          description: 'Unknown or unclassifiable connection network type',
          scoreImpact: 10,
          severity: 'LOW',
        });
        return 10;
    }
  }

  private evalDeviceEnvironmentAndKnown(context: TransactionContext, signals: TriggeredSignal[]): number {
    let score = 0;

    if (context.device.isEmulated) {
      score += 30;
      signals.push({
        ruleId: 'DEV_006',
        description: 'Execution environment is an emulator or virtual machine',
        scoreImpact: 30,
        severity: 'HIGH',
      });
    }

    if (context.device.hasRootOrJailbreak) {
      score += 20;
      signals.push({
        ruleId: 'DEV_007',
        description: 'Device environment is rooted or jailbroken',
        scoreImpact: 20,
        severity: 'MEDIUM',
      });
    }

    if (!context.device.isKnownDevice) {
      if (context.user.transactionCount30Days > 10) {
        score += 15;
        signals.push({
          ruleId: 'DEV_008',
          description: 'New device used for established active account',
          scoreImpact: 15,
          severity: 'MEDIUM',
        });
      } else {
        score += 5;
        signals.push({
          ruleId: 'DEV_009',
          description: 'Unrecognized device ID',
          scoreImpact: 5,
          severity: 'LOW',
        });
      }
    }

    return score;
  }

  private evaluateDevice(context: TransactionContext, signals: TriggeredSignal[]): number {
    return this.evalDeviceConnection(context, signals) + this.evalDeviceEnvironmentAndKnown(context, signals);
  }

  private getMccInfo(mcc: string, signals: TriggeredSignal[]): { mccMultiplier: number; score: number } {
    switch (mcc) {
      case '6051':
      case '6012':
      case '7995':
        signals.push({
          ruleId: 'AMT_001',
          description: 'High-risk merchant category (Crypto/Gambling/Financial Transfer)',
          scoreImpact: 15,
          severity: 'HIGH',
        });
        return { mccMultiplier: 2.0, score: 15 };
      case '5944':
      case '5732':
        signals.push({
          ruleId: 'AMT_002',
          description: 'Medium-risk merchant category (Jewelry/High-value Electronics)',
          scoreImpact: 10,
          severity: 'MEDIUM',
        });
        return { mccMultiplier: 1.4, score: 10 };
      case '4900':
      case '5411':
        return { mccMultiplier: 0.8, score: 0 };
      default:
        return { mccMultiplier: 1.0, score: 0 };
    }
  }

  private evalAmountAnomaly(context: TransactionContext, mccMultiplier: number, signals: TriggeredSignal[]): number {
    if (context.user.avgTransactionAmount30Days > 0) {
      const ratio = context.amount / context.user.avgTransactionAmount30Days;
      if (ratio > 10.0) {
        const added = Math.min(Math.round(30 * mccMultiplier), 50);
        signals.push({
          ruleId: 'AMT_003',
          description: `Extreme transaction amount anomaly (${ratio.toFixed(1)}x of historical average)`,
          scoreImpact: added,
          severity: 'CRITICAL',
        });
        return added;
      }
      if (ratio > 5.0) {
        const added = Math.min(Math.round(20 * mccMultiplier), 35);
        signals.push({
          ruleId: 'AMT_004',
          description: `Significant transaction amount anomaly (${ratio.toFixed(1)}x of historical average)`,
          scoreImpact: added,
          severity: 'HIGH',
        });
        return added;
      }
      if (ratio > 3.0) {
        const added = Math.min(Math.round(10 * mccMultiplier), 20);
        signals.push({
          ruleId: 'AMT_005',
          description: `Moderate transaction amount anomaly (${ratio.toFixed(1)}x of historical average)`,
          scoreImpact: added,
          severity: 'MEDIUM',
        });
        return added;
      }
      return 0;
    }

    if (context.amount > 2000) {
      signals.push({
        ruleId: 'AMT_006',
        description: 'Large transaction amount for a user with no prior transaction history',
        scoreImpact: 25,
        severity: 'HIGH',
      });
      return 25;
    }

    return 0;
  }

  private evaluateAmount(context: TransactionContext, signals: TriggeredSignal[]): { amountAnomalyScore: number; mccMultiplier: number } {
    const mccInfo = this.getMccInfo(context.merchantCategoryCode, signals);
    const anomalyScore = this.evalAmountAnomaly(context, mccInfo.mccMultiplier, signals);
    return {
      amountAnomalyScore: mccInfo.score + anomalyScore,
      mccMultiplier: mccInfo.mccMultiplier,
    };
  }

  private evalUserAccountAgeAndEmail(context: TransactionContext, accountAgeDays: number, signals: TriggeredSignal[]): number {
    let score = 0;

    if (accountAgeDays < 1) {
      score += 25;
      signals.push({
        ruleId: 'USR_001',
        description: 'Account created within the last 24 hours',
        scoreImpact: 25,
        severity: 'HIGH',
      });
    } else if (accountAgeDays < 7) {
      score += 15;
      signals.push({
        ruleId: 'USR_002',
        description: 'Account created within the last 7 days',
        scoreImpact: 15,
        severity: 'MEDIUM',
      });
    } else if (accountAgeDays < 30) {
      score += 5;
      signals.push({
        ruleId: 'USR_003',
        description: 'Account created within the last 30 days',
        scoreImpact: 5,
        severity: 'LOW',
      });
    }

    const emailDomain = context.user.email.split('@')[1]?.toLowerCase();
    if (emailDomain && context.disposableEmailDomains.includes(emailDomain)) {
      score += 25;
      signals.push({
        ruleId: 'USR_004',
        description: 'Disposable or temporary email domain utilized',
        scoreImpact: 25,
        severity: 'HIGH',
      });
    }

    return score;
  }

  private evalUserVerificationAndHistory(context: TransactionContext, signals: TriggeredSignal[]): number {
    let score = 0;

    if (!context.user.emailVerified) {
      score += 10;
      signals.push({
        ruleId: 'USR_005',
        description: 'User email address is unverified',
        scoreImpact: 10,
        severity: 'LOW',
      });
    }

    if (!context.user.phoneVerified) {
      score += 5;
      signals.push({
        ruleId: 'USR_006',
        description: 'User phone number is unverified',
        scoreImpact: 5,
        severity: 'LOW',
      });
    }

    if (context.user.chargebackHistoryCount > 0) {
      if (context.user.chargebackHistoryCount >= 2) {
        score += 35;
        signals.push({
          ruleId: 'USR_007',
          description: 'Multiple prior chargebacks recorded on user account',
          scoreImpact: 35,
          severity: 'CRITICAL',
        });
      } else {
        score += 20;
        signals.push({
          ruleId: 'USR_008',
          description: 'Prior chargeback history recorded on user account',
          scoreImpact: 20,
          severity: 'HIGH',
        });
      }
    }

    if (context.user.failedLoginAttempts24h >= 5) {
      score += 20;
      signals.push({
        ruleId: 'USR_009',
        description: 'Elevated number of failed login attempts in last 24 hours',
        scoreImpact: 20,
        severity: 'MEDIUM',
      });
    }

    return score;
  }

  private evaluateUser(context: TransactionContext, accountAgeDays: number, signals: TriggeredSignal[]): number {
    return this.evalUserAccountAgeAndEmail(context, accountAgeDays, signals) +
           this.evalUserVerificationAndHistory(context, signals);
  }

  private evalAnonymizedSynergy(
    context: TransactionContext,
    accountAgeDays: number,
    signals: TriggeredSignal[],
  ): number {
    const anonymizedTypes = [ConnectionType.TOR, ConnectionType.PROXY, ConnectionType.VPN];
    const isAnonymized = anonymizedTypes.includes(context.device.connectionType);

    if (!isAnonymized || context.device.isKnownDevice) {
      return 0;
    }

    if (accountAgeDays < 7) {
      signals.push({
        ruleId: 'SYN_001',
        description: 'Synergistic Risk: Anonymized connection + New Device + New Account',
        scoreImpact: 25,
        severity: 'CRITICAL',
      });
      return 25;
    }

    if (context.amount > 1000) {
      signals.push({
        ruleId: 'SYN_002',
        description: 'Synergistic Risk: Anonymized connection + New Device + High Transaction Amount',
        scoreImpact: 20,
        severity: 'HIGH',
      });
      return 20;
    }

    return 0;
  }

  private evalOffHoursSynergy(
    context: TransactionContext,
    mccMultiplier: number,
    signals: TriggeredSignal[],
  ): number {
    const txHour = new Date(context.timestamp).getUTCHours();
    const isOffHours = txHour >= 1 && txHour <= 4;

    if (isOffHours && !context.device.isKnownDevice && mccMultiplier > 1.2) {
      signals.push({
        ruleId: 'SYN_003',
        description: 'Synergistic Risk: Off-hours high-risk MCC transaction on unknown device',
        scoreImpact: 15,
        severity: 'MEDIUM',
      });
      return 15;
    }

    return 0;
  }

  private evaluateSynergy(
    context: TransactionContext,
    accountAgeDays: number,
    mccMultiplier: number,
    signals: TriggeredSignal[],
  ): number {
    return this.evalAnonymizedSynergy(context, accountAgeDays, signals) +
           this.evalOffHoursSynergy(context, mccMultiplier, signals);
  }

  private determineAction(finalScore: number, isAutomatedReject: boolean, mfaEnabled: boolean): FraudAction {
    if (isAutomatedReject || finalScore >= 85) {
      return FraudAction.REJECT;
    }
    if (finalScore >= 65) {
      return FraudAction.REVIEW;
    }
    if (finalScore >= 40) {
      return mfaEnabled ? FraudAction.CHALLENGE_MFA : FraudAction.REVIEW;
    }
    return FraudAction.APPROVE;
  }

  private calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}