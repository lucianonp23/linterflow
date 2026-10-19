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
    let isAutomatedReject = false;

    let velocityScore = 0;
    let geoScore = 0;
    let deviceScore = 0;
    let amountAnomalyScore = 0;
    let userRiskScore = 0;
    let synergyScore = 0;

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

    if (txCount5m >= 3) {
      if (txSum5m > 1000) {
        velocityScore += 35;
        signals.push({
          ruleId: 'VEL_001',
          description: 'High frequency and high aggregate amount in 5-minute window',
          scoreImpact: 35,
          severity: 'HIGH',
        });
      } else {
        velocityScore += 20;
        signals.push({
          ruleId: 'VEL_002',
          description: 'High frequency transactions in 5-minute window',
          scoreImpact: 20,
          severity: 'MEDIUM',
        });
      }
    } else if (txCount1h >= 8) {
      velocityScore += 25;
      signals.push({
        ruleId: 'VEL_003',
        description: 'Exceeded hourly transaction frequency threshold',
        scoreImpact: 25,
        severity: 'MEDIUM',
      });
    }

    if (failedTxCount24h >= 3) {
      if (failedTxCount24h >= 6) {
        velocityScore += 30;
        signals.push({
          ruleId: 'VEL_004',
          description: 'Excessive failed transactions in last 24 hours',
          scoreImpact: 30,
          severity: 'HIGH',
        });
      } else {
        velocityScore += 15;
        signals.push({
          ruleId: 'VEL_005',
          description: 'Multiple failed transactions in last 24 hours',
          scoreImpact: 15,
          severity: 'MEDIUM',
        });
      }
    }

    let lowAmountCount = 0;
    const sortedHistory = [...context.history].sort((a, b) => b.timestamp - a.timestamp);
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
      velocityScore += 40;
      signals.push({
        ruleId: 'VEL_006',
        description: 'Potential card testing pattern detected (small rapid micro-transactions followed by large purchase)',
        scoreImpact: 40,
        severity: 'CRITICAL',
      });
    }

    if (sortedHistory.length > 0) {
      const lastTx = sortedHistory[0];
      const distanceKm = this.calculateHaversineDistance(
        context.location.latitude,
        context.location.longitude,
        lastTx.location.latitude,
        lastTx.location.longitude,
      );
      const timeDeltaHours = (context.timestamp - lastTx.timestamp) / (1000 * 60 * 60);

      if (timeDeltaHours > 0) {
        const speedKmH = distanceKm / timeDeltaHours;
        if (speedKmH > 900 && distanceKm > 300) {
          if (context.amount > 500) {
            geoScore += 45;
            signals.push({
              ruleId: 'GEO_001',
              description: 'Impossible travel velocity detected with high-value transaction',
              scoreImpact: 45,
              severity: 'CRITICAL',
            });
          } else {
            geoScore += 30;
            signals.push({
              ruleId: 'GEO_002',
              description: 'Impossible travel velocity detected',
              scoreImpact: 30,
              severity: 'HIGH',
            });
          }
        } else if (speedKmH > 500 && distanceKm > 200) {
          geoScore += 15;
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
      geoScore += 25;
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
      geoScore += 20;
      signals.push({
        ruleId: 'GEO_005',
        description: 'Mismatched transaction location relative to user home country and card issuing country',
        scoreImpact: 20,
        severity: 'MEDIUM',
      });
    }

    switch (context.device.connectionType) {
      case ConnectionType.TOR:
        deviceScore += 40;
        signals.push({
          ruleId: 'DEV_001',
          description: 'Connection routed through TOR anonymizing network',
          scoreImpact: 40,
          severity: 'CRITICAL',
        });
        break;
      case ConnectionType.PROXY:
        deviceScore += 25;
        signals.push({
          ruleId: 'DEV_002',
          description: 'Connection routed through proxy server',
          scoreImpact: 25,
          severity: 'HIGH',
        });
        break;
      case ConnectionType.VPN:
        if (!context.device.isKnownDevice) {
          deviceScore += 20;
          signals.push({
            ruleId: 'DEV_003',
            description: 'VPN detected on an unrecognized device',
            scoreImpact: 20,
            severity: 'MEDIUM',
          });
        } else {
          deviceScore += 5;
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
        deviceScore += 10;
        signals.push({
          ruleId: 'DEV_005',
          description: 'Unknown or unclassifiable connection network type',
          scoreImpact: 10,
          severity: 'LOW',
        });
        break;
    }

    if (context.device.isEmulated) {
      deviceScore += 30;
      signals.push({
        ruleId: 'DEV_006',
        description: 'Execution environment is an emulator or virtual machine',
        scoreImpact: 30,
        severity: 'HIGH',
      });
    }

    if (context.device.hasRootOrJailbreak) {
      deviceScore += 20;
      signals.push({
        ruleId: 'DEV_007',
        description: 'Device environment is rooted or jailbroken',
        scoreImpact: 20,
        severity: 'MEDIUM',
      });
    }

    if (!context.device.isKnownDevice) {
      if (context.user.transactionCount30Days > 10) {
        deviceScore += 15;
        signals.push({
          ruleId: 'DEV_008',
          description: 'New device used for established active account',
          scoreImpact: 15,
          severity: 'MEDIUM',
        });
      } else {
        deviceScore += 5;
        signals.push({
          ruleId: 'DEV_009',
          description: 'Unrecognized device ID',
          scoreImpact: 5,
          severity: 'LOW',
        });
      }
    }

    let mccMultiplier = 1.0;
    switch (context.merchantCategoryCode) {
      case '6051':
      case '6012':
      case '7995':
        mccMultiplier = 2.0;
        amountAnomalyScore += 15;
        signals.push({
          ruleId: 'AMT_001',
          description: 'High-risk merchant category (Crypto/Gambling/Financial Transfer)',
          scoreImpact: 15,
          severity: 'HIGH',
        });
        break;
      case '5944':
      case '5732':
        mccMultiplier = 1.4;
        amountAnomalyScore += 10;
        signals.push({
          ruleId: 'AMT_002',
          description: 'Medium-risk merchant category (Jewelry/High-value Electronics)',
          scoreImpact: 10,
          severity: 'MEDIUM',
        });
        break;
      case '4900':
      case '5411':
        mccMultiplier = 0.8;
        break;
      default:
        mccMultiplier = 1.0;
        break;
    }

    if (context.user.avgTransactionAmount30Days > 0) {
      const ratio = context.amount / context.user.avgTransactionAmount30Days;
      if (ratio > 10.0) {
        const added = Math.min(Math.round(30 * mccMultiplier), 50);
        amountAnomalyScore += added;
        signals.push({
          ruleId: 'AMT_003',
          description: `Extreme transaction amount anomaly (${ratio.toFixed(1)}x of historical average)`,
          scoreImpact: added,
          severity: 'CRITICAL',
        });
      } else if (ratio > 5.0) {
        const added = Math.min(Math.round(20 * mccMultiplier), 35);
        amountAnomalyScore += added;
        signals.push({
          ruleId: 'AMT_004',
          description: `Significant transaction amount anomaly (${ratio.toFixed(1)}x of historical average)`,
          scoreImpact: added,
          severity: 'HIGH',
        });
      } else if (ratio > 3.0) {
        const added = Math.min(Math.round(10 * mccMultiplier), 20);
        amountAnomalyScore += added;
        signals.push({
          ruleId: 'AMT_005',
          description: `Moderate transaction amount anomaly (${ratio.toFixed(1)}x of historical average)`,
          scoreImpact: added,
          severity: 'MEDIUM',
        });
      }
    } else if (context.amount > 2000) {
      amountAnomalyScore += 25;
      signals.push({
        ruleId: 'AMT_006',
        description: 'Large transaction amount for a user with no prior transaction history',
        scoreImpact: 25,
        severity: 'HIGH',
      });
    }

    const accountAgeDays = (context.timestamp - context.user.accountCreatedTimestamp) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < 1) {
      userRiskScore += 25;
      signals.push({
        ruleId: 'USR_001',
        description: 'Account created within the last 24 hours',
        scoreImpact: 25,
        severity: 'HIGH',
      });
    } else if (accountAgeDays < 7) {
      userRiskScore += 15;
      signals.push({
        ruleId: 'USR_002',
        description: 'Account created within the last 7 days',
        scoreImpact: 15,
        severity: 'MEDIUM',
      });
    } else if (accountAgeDays < 30) {
      userRiskScore += 5;
      signals.push({
        ruleId: 'USR_003',
        description: 'Account created within the last 30 days',
        scoreImpact: 5,
        severity: 'LOW',
      });
    }

    const emailDomain = context.user.email.split('@')[1]?.toLowerCase();
    if (emailDomain && context.disposableEmailDomains.includes(emailDomain)) {
      userRiskScore += 25;
      signals.push({
        ruleId: 'USR_004',
        description: 'Disposable or temporary email domain utilized',
        scoreImpact: 25,
        severity: 'HIGH',
      });
    }

    if (!context.user.emailVerified) {
      userRiskScore += 10;
      signals.push({
        ruleId: 'USR_005',
        description: 'User email address is unverified',
        scoreImpact: 10,
        severity: 'LOW',
      });
    }

    if (!context.user.phoneVerified) {
      userRiskScore += 5;
      signals.push({
        ruleId: 'USR_006',
        description: 'User phone number is unverified',
        scoreImpact: 5,
        severity: 'LOW',
      });
    }

    if (context.user.chargebackHistoryCount > 0) {
      if (context.user.chargebackHistoryCount >= 2) {
        userRiskScore += 35;
        signals.push({
          ruleId: 'USR_007',
          description: 'Multiple prior chargebacks recorded on user account',
          scoreImpact: 35,
          severity: 'CRITICAL',
        });
      } else {
        userRiskScore += 20;
        signals.push({
          ruleId: 'USR_008',
          description: 'Prior chargeback history recorded on user account',
          scoreImpact: 20,
          severity: 'HIGH',
        });
      }
    }

    if (context.user.failedLoginAttempts24h >= 5) {
      userRiskScore += 20;
      signals.push({
        ruleId: 'USR_009',
        description: 'Elevated number of failed login attempts in last 24 hours',
        scoreImpact: 20,
        severity: 'MEDIUM',
      });
    }

    const isAnonymized =
      context.device.connectionType === ConnectionType.TOR ||
      context.device.connectionType === ConnectionType.PROXY ||
      context.device.connectionType === ConnectionType.VPN;

    const isNewAccount = accountAgeDays < 7;
    const isHighValue = context.amount > 1000;

    if (isAnonymized && !context.device.isKnownDevice) {
      if (isNewAccount) {
        synergyScore += 25;
        signals.push({
          ruleId: 'SYN_001',
          description: 'Synergistic Risk: Anonymized connection + New Device + New Account',
          scoreImpact: 25,
          severity: 'CRITICAL',
        });
      } else if (isHighValue) {
        synergyScore += 20;
        signals.push({
          ruleId: 'SYN_002',
          description: 'Synergistic Risk: Anonymized connection + New Device + High Transaction Amount',
          scoreImpact: 20,
          severity: 'HIGH',
        });
      }
    }

    const txDate = new Date(context.timestamp);
    const txHour = txDate.getUTCHours();
    const isOffHours = txHour >= 1 && txHour <= 4;

    if (isOffHours && !context.device.isKnownDevice && mccMultiplier > 1.2) {
      synergyScore += 15;
      signals.push({
        ruleId: 'SYN_003',
        description: 'Synergistic Risk: Off-hours high-risk MCC transaction on unknown device',
        scoreImpact: 15,
        severity: 'MEDIUM',
      });
    }

    let rawScore = velocityScore + geoScore + deviceScore + amountAnomalyScore + userRiskScore + synergyScore;
    let finalScore = Math.min(Math.max(rawScore, 0), 100);

    if (isAutomatedReject) {
      finalScore = 100;
    }

    let action: FraudAction;

    if (isAutomatedReject || finalScore >= 85) {
      action = FraudAction.REJECT;
    } else if (finalScore >= 65) {
      action = FraudAction.REVIEW;
    } else if (finalScore >= 40) {
      if (!context.user.mfaEnabled) {
        action = FraudAction.REVIEW;
      } else {
        action = FraudAction.CHALLENGE_MFA;
      }
    } else {
      action = FraudAction.APPROVE;
    }

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
