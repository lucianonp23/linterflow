import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  PENDING_CANCEL = 'PENDING_CANCEL',
}

export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  tier: number;
  isActive: boolean;
}

export interface PaymentMethod {
  id: string;
  isExpired: boolean;
  isValid: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  paymentMethod: PaymentMethod;
  hasUnpaidInvoices: boolean;
  planChangeCountThisCycle: number;
  maxAllowedPlanChanges: number;
}

export interface PlanChangeResult {
  subscriptionId: string;
  previousPlanId: string;
  newPlanId: string;
  isUpgrade: boolean;
  proratedAmountCents: number;
  effectiveImmediately: boolean;
}

@Injectable()
export class SubscriptionBillingService {
  private readonly plans = new Map<string, Plan>();
  private readonly subscriptions = new Map<string, Subscription>();

  public changePlan(subscriptionId: string, targetPlanId: string): PlanChangeResult {
    const subscription = this.getSubscriptionOrThrow(subscriptionId);

    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Subscription is not active');
    }

    const targetPlan = this.getPlanOrThrow(targetPlanId, 'Target plan not found');

    if (!targetPlan.isActive) {
      throw new UnprocessableEntityException('Target plan is inactive');
    }

    if (subscription.planId === targetPlanId) {
      throw new ConflictException('Subscription already uses this plan');
    }

    if (subscription.hasUnpaidInvoices) {
      throw new UnprocessableEntityException('Cannot change plan with unpaid invoices');
    }

    if (this.isPaymentMethodInvalid(subscription.paymentMethod)) {
      throw new UnprocessableEntityException('Payment method is invalid or expired');
    }

    const currentPlan = this.getPlanOrThrow(subscription.planId, 'Current plan not found');
    const isUpgrade = targetPlan.tier > currentPlan.tier;
    const proratedAmountCents = targetPlan.priceCents - currentPlan.priceCents;

    subscription.planId = targetPlan.id;
    subscription.planChangeCountThisCycle += 1;

    return {
      subscriptionId: subscription.id,
      previousPlanId: currentPlan.id,
      newPlanId: targetPlan.id,
      isUpgrade,
      proratedAmountCents,
      effectiveImmediately: isUpgrade,
    };
  }

  public cancelSubscription(subscriptionId: string): Subscription {
    const subscription = this.getSubscriptionOrThrow(subscriptionId);

    if (subscription.status === SubscriptionStatus.CANCELED) {
      throw new BadRequestException('Subscription is already canceled');
    }

    if (subscription.hasUnpaidInvoices) {
      throw new UnprocessableEntityException('Cannot cancel with pending unpaid invoices');
    }

    subscription.status = SubscriptionStatus.PENDING_CANCEL;
    return subscription;
  }

  public reactivateSubscription(subscriptionId: string): Subscription {
    const subscription = this.getSubscriptionOrThrow(subscriptionId);

    const isReactivatable =
      subscription.status === SubscriptionStatus.PENDING_CANCEL ||
      subscription.status === SubscriptionStatus.CANCELED;

    if (!isReactivatable) {
      throw new BadRequestException('Subscription does not require reactivation');
    }

    if (this.isPaymentMethodInvalid(subscription.paymentMethod)) {
      throw new UnprocessableEntityException('Cannot reactivate without valid payment method');
    }

    subscription.status = SubscriptionStatus.ACTIVE;
    return subscription;
  }

  private getSubscriptionOrThrow(subscriptionId: string): Subscription {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    return subscription;
  }

  private getPlanOrThrow(planId: string, errorMessage = 'Plan not found'): Plan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new NotFoundException(errorMessage);
    }
    return plan;
  }

  private isPaymentMethodInvalid(paymentMethod: PaymentMethod): boolean {
    return paymentMethod.isExpired || !paymentMethod.isValid;
  }
}