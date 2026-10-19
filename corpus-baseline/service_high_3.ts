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

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const EARTH_RADIUS_KM = 6371;

@Injectable()
export class FraudDetectionEngineService {
  public evaluateTransaction(context: TransactionContext): FraudEvaluationResult {
    const signals: TriggeredSignal[] = [];

    const blacklistResult = this.evaluateBlacklists(context);
    signals.push(...blacklistResult.signals);

    const sortedHistory = [...context.history].sort((a, b) => b.timestamp - a.timestamp);

    const velocityResult = this.evaluateVelocity(context, sortedHistory);
    signals.push(...velocityResult.signals);

    const geoResult = this.evaluateGeo(context, sortedHistory);
    signals.push(...geoResult.signals);

    const deviceResult = this.evaluateDevice(context);
    signals.push(...deviceResult.signals);

    const mccInfo = this.getMccCategoryInfo(context.merchantCategoryCode);
    if (mccInfo.signal) {
      signals.push(mccInfo.signal);
    }

    const amountAnomalyResult = this.evaluateAmountAnomaly(context, mccInfo.multiplier, mccInfo.score);
    signals.push(...amountAnomalyResult.signals);

    const accountAgeDays = (context.timestamp - context.user.accountCreatedTimestamp) / MS_PER_DAY;
    const userRiskResult = this.evaluateUserRisk(context, accountAgeDays);
    signals.push(...userRiskResult.signals);

    const synergyResult = this.evaluateSynergy(context, accountAgeDays, mccInfo.multiplier);
    signals.push(...synergyResult.signals);

    const rawScore =
      velocityResult.score +
      geoResult.score +
      deviceResult.score +
      amountAnomalyResult.score +
      userRiskResult.score +
      synergyResult.score;

    let finalScore = Math.min(Math.max(rawScore, 0), 100);
    if (blacklistResult.isAutomatedReject) {
      finalScore = 100;
    }

    const action = this.determineAction(finalScore, blacklistResult.isAutomatedReject, context.user.mfaEnabled);

    return {
      transactionId: context.transactionId,
      finalScore,
      action,
      isAutomatedReject: blacklistResult.isAutomatedReject,
      signals,
      breakdown: {
        velocityScore: velocityResult.score,
        geoScore: geoResult.score,
        deviceScore: deviceResult.score,
        amountAnomalyScore: amountAnomalyResult.score,
        userRiskScore: userRiskResult.score,
        synergyScore: synergyResult.score,
      },
    };
  }

  private evaluateBlacklists(context: TransactionContext): { isAutomatedReject: boolean; signals: TriggeredSignal[] } {
    const signals: TriggeredSignal[] = [];
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

    return { isAutomatedReject, signals };
  }

  private evaluateVelocity(
    context: TransactionContext,
    sortedHistory: HistoricalTransaction[],
  ): { score: number; signals: TriggeredSignal[] } {
    let score = 0;
    const signals: TriggeredSignal[] = [];

    const fiveMinsAgo = context.timestamp - 5 * MS_PER_MINUTE;
    const oneHourAgo = context.timestamp - 1 * MS_PER_HOUR;
    const twentyFourHoursAgo = context.timestamp - 24 * MS_PER_HOUR;

    let txCount5m = 0;
    let txSum5m = 0;
    let txCount1h = 0;
    let failedTxCount24h = 0;

    for (const tx of context.history) {
      if (tx.timestamp >= fiveMinsAgo) {
        txCount5m++;
        txSum5m += tx.amount;
      }
      if (tx.timestamp >= oneHourAgo) {
        txCount1h++;
      }
      if (tx.timestamp >= twentyFourHoursAgo) {
        if (tx.status === 'FAILED' || tx.status === 'REJECTED') {
          failedTxCount24h++;
        }
      }
    }

    if (txCount5m >= 3) {
      if (txSum5m > 1000) {
        score += 35;
        signals.push({
          ruleId: 'VEL_001',
          description: 'High frequency and high aggregate amount in 5-minute window',
          scoreImpact: 35,
          severity: 'HIGH',
        });
      } else {
        score += 20;
        signals.push({
          ruleId: 'VEL_002',
          description: 'High frequency transactions in 5-minute window',
          scoreImpact: 20,
          severity: 'MEDIUM',
        });
      }
    } else if (txCount1h >= 8) {
      score += 25;
      signals.push({
        ruleId: 'VEL_003',
        description: 'Exceeded hourly transaction frequency threshold',
        scoreImpact: 25,
        severity: 'MEDIUM',
      });
    }

    if (failedTxCount24h >= 3) {
      if (failedTxCount24h >= 6) {
        score += 30;
        signals.push({
          ruleId: 'VEL_004',
          description: 'Excessive failed transactions in last 24 hours',
          scoreImpact: 30,
          severity: 'HIGH',
        });
      } else {
        score += 15;
        signals.push({
          ruleId: 'VEL_005',
          description: 'Multiple failed transactions in last 24 hours',
          scoreImpact: 15,
          severity: 'MEDIUM',
        });
      }
    }

    let lowAmountCount = 0;
    const fifteenMinsAgo = context.timestamp - 15 * MS_PER_MINUTE;
    for (const pastTx of sortedHistory) {
      if (pastTx.timestamp >= fifteenMinsAgo) {
        if (pastTx.amount > 0 && pastTx.amount <= 5.0) {
          lowAmountCount++;
        }
      } else {
        break;
      }
    }

    if (lowAmountCount >= 3 && context.amount > 100) {
      score += 40;
      signals.push({
        ruleId: 'VEL_006',
        description: 'Potential card testing pattern detected (small rapid micro-transactions followed by large purchase)',
        scoreImpact: 40,
        severity: 'CRITICAL',
      });
    }

    return { score, signals };
  }

  private evaluateGeo(
    context: TransactionContext,
    sortedHistory: HistoricalTransaction[],
  ): { score: number; signals: TriggeredSignal[] } {
    let score = 0;
    const signals: TriggeredSignal[] = [];

    if (sortedHistory.length > 0) {
      const lastTx = sortedHistory[0];
      const distanceKm = this.calculateHaversineDistance(
        context.location.latitude,
        context.location.longitude,
        lastTx.location.latitude,
        lastTx.location.longitude,
      );
      const timeDeltaHours = (context.timestamp - lastTx.timestamp) / MS_PER_HOUR;

      if (timeDeltaHours > 0) {
        const speedKmH = distanceKm / timeDeltaHours;
        if (speedKmH > 900 && distanceKm > 300) {
          if (context.amount > 500) {
            score += 45;
            signals.push({
              ruleId: 'GEO_001',
              description: 'Impossible travel velocity detected with high-value transaction',
              scoreImpact: 45,
              severity: 'CRITICAL',
            });
          } else {
            score += 30;
            signals.push({
              ruleId: 'GEO_002',
              description: 'Impossible travel velocity detected',
              scoreImpact: 30,
              severity: 'HIGH',
            });
          }
        } else if (speedKmH > 500 && distanceKm > 200) {
          score += 15;
          signals.push({
            ruleId: 'GEO_003',
            description: 'Unusually high physical travel velocity',
            scoreImpact: 15,
            severity: 'MEDIUM',
          });
        }
      }
    }

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

    return { score, signals };
  }

  private evaluateDevice(context: TransactionContext): { score: number; signals: TriggeredSignal[] } {
    let score = 0;
    const signals: TriggeredSignal[] = [];

    switch (context.device.connectionType) {
      case ConnectionType.TOR:
        score += 40;
        signals.push({
          ruleId: 'DEV_001',
          description: 'Connection routed through TOR anonymizing network',
          scoreImpact: 40,
          severity: 'CRITICAL',
        });
        break;
      case ConnectionType.PROXY:
        score += 25;
        signals.push({
          ruleId: 'DEV_002',
          description: 'Connection routed through proxy server',
          scoreImpact: 25,
          severity: 'HIGH',
        });
        break;
      case ConnectionType.VPN:
        if (!context.device.isKnownDevice) {
          score += 20;
          signals.push({
            ruleId: 'DEV_003',
            description: 'VPN detected on an unrecognized device',
            scoreImpact: 20,
            severity: 'MEDIUM',
          });
        } else {
          score += 5;
          signals.push({
            ruleId: 'DEV_004',
            description: 'VPN detected on a known user device',
            scoreImpact: 5,
            severity: 'LOW',
          });
        }
        break;
      case ConnectionType.CELLULAR:
      case ConnectionType.RESIDENTIAL:
        break;
      default:
        score += 10;
        signals.push({
          ruleId: 'DEV_005',
          description: 'Unknown or unclassifiable connection network type',
          scoreImpact: 10,
          severity: 'LOW',
        });
        break;
    }

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

    return { score, signals };
  }

  private getMccCategoryInfo(mcc: string): { multiplier: number; score: number; signal?: TriggeredSignal } {
    switch (mcc) {
      case '6051':
      case '6012':
      case '7995':
        return {
          multiplier: 2.0,
          score: 15,
          signal: {
            ruleId: 'AMT_001',
            description: 'High-risk merchant category (Crypto/Gambling/Financial Transfer)',
            scoreImpact: 15,
            severity: 'HIGH',
          },
        };
      case '5944':
      case '5732':
        return {
          multiplier: 1.4,
          score: 10,
          signal: {
            ruleId: 'AMT_002',
            description: 'Medium-risk merchant category (Jewelry/High-value Electronics)',
            scoreImpact: 10,
            severity: 'MEDIUM',
          },
        };
      case '4900':
      case '5411':
        return { multiplier: 0.8, score: 0 };
      default:
        return { multiplier: 1.0, score: 0 };
    }
  }

  private evaluateAmountAnomaly(
    context: TransactionContext,
    mccMultiplier: number,
    baseMccScore: number,
  ): { score: number; signals: TriggeredSignal[] } {
    let score = baseMccScore;
    const signals: TriggeredSignal[] = [];

    if (context.user.avgTransactionAmount30Days > 0) {
      const ratio = context.amount / context.user.avgTransactionAmount30Days;
      if (ratio > 10.0) {
        const added = Math.min(Math.round(30 * mccMultiplier), 50);
        score += added;
        signals.push({
          ruleId: 'AMT_003',
          description: `Extreme transaction amount anomaly (${ratio.toFixed(1)}x of historical average)`,
          scoreImpact: added,
          severity: 'CRITICAL',
        });
      } else if (ratio > 5.0) {
        const added = Math.min(Math.round(20 * mccMultiplier), 35);
        score += added;
        signals.push({
          ruleId: 'AMT_004',
          description: `Significant transaction amount anomaly (${ratio.toFixed(1)}x of historical average)`,
          scoreImpact: added,
          severity: 'HIGH',
        });
      } else if (ratio > 3.0) {
        const added = Math.min(Math.round(10 * mccMultiplier), 20);
        score += added;
        signals.push({
          ruleId: 'AMT_005',
          description: `Moderate transaction amount anomaly (${ratio.toFixed(1)}x of historical average)`,
          scoreImpact: added,
          severity: 'MEDIUM',
        });
      }
    } else if (context.amount > 2000) {
      score += 25;
      signals.push({
        ruleId: 'AMT_006',
        description: 'Large transaction amount for a user with no prior transaction history',
        scoreImpact: 25,
        severity: 'HIGH',
      });
    }

    return { score, signals };
  }

  private evaluateUserRisk(
    context: TransactionContext,
    accountAgeDays: number,
  ): { score: number; signals: TriggeredSignal[] } {
    let score = 0;
    const signals: TriggeredSignal[] = [];

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

    return { score, signals };
  }

  private evaluateSynergy(
    context: TransactionContext,
    accountAgeDays: number,
    mccMultiplier: number,
  ): { score: number; signals: TriggeredSignal[] } {
    let score = 0;
    const signals: TriggeredSignal[] = [];

    const isAnonymized =
      context.device.connectionType === ConnectionType.TOR ||
      context.device.connectionType === ConnectionType.PROXY ||
      context.device.connectionType === ConnectionType.VPN;

    const isNewAccount = accountAgeDays < 7;
    const isHighValue = context.amount > 1000;

    if (isAnonymized && !context.device.isKnownDevice) {
      if (isNewAccount) {
        score += 25;
        signals.push({
          ruleId: 'SYN_001',
          description: 'Synergistic Risk: Anonymized connection + New Device + New Account',
          scoreImpact: 25,
          severity: 'CRITICAL',
        });
      } else if (isHighValue) {
        score += 20;
        signals.push({
          ruleId: 'SYN_002',
          description: 'Synergistic Risk: Anonymized connection + New Device + High Transaction Amount',
          scoreImpact: 20,
          severity: 'HIGH',
        });
      }
    }

    const txHour = new Date(context.timestamp).getUTCHours();
    const isOffHours = txHour >= 1 && txHour <= 4;

    if (isOffHours && !context.device.isKnownDevice && mccMultiplier > 1.2) {
      score += 15;
      signals.push({
        ruleId: 'SYN_003',
        description: 'Synergistic Risk: Off-hours high-risk MCC transaction on unknown device',
        scoreImpact: 15,
        severity: 'MEDIUM',
      });
    }

    return { score, signals };
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
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}