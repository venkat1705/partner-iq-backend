import { Injectable } from '@nestjs/common';
import { dbStore } from '../../../database/store';
import { SubscriptionStatus } from '../enums/billing.enums';

const INR_PLAN_PRICE_BY_CODE: Record<string, number> = {
  STARTER: 472900,
  PRO: 1920600,
  BUSINESS: 4816000,
};

@Injectable()
export class AdminBillingService {
  subscriptions() {
    const paymentBackedRows = dbStore.billingPayments.map((payment) => {
      const subscription = payment.subscriptionId
        ? dbStore.billingSubscriptions.find((item) => item.id === payment.subscriptionId)
        : dbStore.billingSubscriptions
          .filter((item) => item.organizationId === payment.organizationId)
          .sort((a, b) => b.modifiedDate.getTime() - a.modifiedDate.getTime())[0];
      const plan = subscription
        ? dbStore.billingPlans.find((item) => item.id === subscription.planId)
        : undefined;
      const organization = dbStore.organizations.find((item) => item.id === payment.organizationId);
      const inferredPlan = this.inferPlanFromPayment(payment.amount);
      const planCode = plan?.code || inferredPlan.code;
      const price = plan?.price || inferredPlan.price || payment.amount;

      return {
        id: payment.id,
        paymentId: payment.id,
        providerPaymentId: payment.providerPaymentId,
        organizationId: payment.organizationId,
        subscriptionId: subscription?.id || payment.subscriptionId,
        planId: subscription?.planId,
        provider: payment.provider,
        status: payment.status === 'CAPTURED'
          ? SubscriptionStatus.ACTIVE
          : payment.status === 'FAILED'
            ? SubscriptionStatus.PAST_DUE
            : subscription?.status || payment.status,
        billingInterval: subscription?.billingInterval || 'MONTHLY',
        currentPeriodEnd: subscription?.currentPeriodEnd,
        nextBillingDate: subscription?.nextBillingDate || subscription?.currentPeriodEnd,
        modifiedDate: payment.modifiedDate || payment.createdDate,
        createdDate: payment.createdDate,
        organizationName: organization?.name || payment.organizationId,
        planCode,
        planName: plan?.name || inferredPlan.name,
        price,
        currency: plan?.currency || payment.currency || 'INR',
        paymentAmount: payment.amount,
        paymentStatus: payment.status,
        providerOrderId: payment.providerOrderId,
        providerInvoiceId: payment.providerInvoiceId,
        paymentMethod: payment.paymentMethod,
        failureCode: payment.failureCode,
        failureReason: payment.failureReason,
        paidAt: payment.paidAt,
      };
    });

    const subscriptionOnlyRows = dbStore.billingSubscriptions
      .filter((subscription) =>
        !dbStore.billingPayments.some((payment) => payment.subscriptionId === subscription.id) &&
        (subscription.rowStatus === 'ACTIVE' || subscription.status === SubscriptionStatus.ACTIVE),
      )
      .map((subscription) => {
        const plan = dbStore.billingPlans.find((item) => item.id === subscription.planId);
        const organization = dbStore.organizations.find((item) => item.id === subscription.organizationId);
        const latestPayment = dbStore.billingPayments
          .filter((payment) => payment.subscriptionId === subscription.id || payment.organizationId === subscription.organizationId)
          .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime())[0];
        const inferredPlan = this.inferPlanFromPayment(latestPayment?.amount || 0);
        const planCode = plan?.code || inferredPlan.code;
        const price = plan?.price || inferredPlan.price || latestPayment?.amount || 0;
        return {
          ...subscription,
          organizationName: organization?.name || subscription.organizationId,
          planCode,
          planName: plan?.name || inferredPlan.name,
          price,
          currency: plan?.currency || latestPayment?.currency || 'INR',
        };
      });

    return [...paymentBackedRows, ...subscriptionOnlyRows]
      .sort((a, b) => b.modifiedDate.getTime() - a.modifiedDate.getTime());
  }

  payments() {
    return dbStore.billingPayments
      .map((payment) => {
        const organization = dbStore.organizations.find((item) => item.id === payment.organizationId);
        return {
          ...payment,
          organizationName: organization?.name || 'Unknown organization',
        };
      })
      .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime());
  }

  overview() {
    const subscriptionRows = this.subscriptions();
    const activeSubscriptions = subscriptionRows.filter((item) => item.status === SubscriptionStatus.ACTIVE);
    const mrr = activeSubscriptions.reduce((sum, subscription) => {
      if (subscription.planCode === 'FREE') return sum;
      return sum + (subscription.billingInterval === 'YEARLY' ? Math.round(subscription.price / 12) : subscription.price);
    }, 0);

    return {
      mrr,
      arr: mrr * 12,
      activeSubscriptions: activeSubscriptions.length,
      trialSubscriptions: dbStore.billingSubscriptions.filter((item) => item.trialEnd && item.status === SubscriptionStatus.ACTIVE).length,
      cancelledSubscriptions: dbStore.billingSubscriptions.filter((item) => item.status === SubscriptionStatus.CANCELLED).length,
      pastDueSubscriptions: dbStore.billingSubscriptions.filter((item) => item.status === SubscriptionStatus.PAST_DUE).length,
      successfulPayments: dbStore.billingPayments.filter((item) => item.status === 'CAPTURED').length,
      failedPayments: dbStore.billingPayments.filter((item) => item.status === 'FAILED').length,
      refunds: dbStore.billingRefunds.length,
      planDistribution: ['STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE'].map((planCode) => ({
        plan: planCode,
        count: activeSubscriptions.filter((subscription) => subscription.planCode === planCode).length,
      })),
      revenueTrend: [],
      subscriptionGrowth: [],
      churn: 0,
      failedPaymentRate: dbStore.billingPayments.length === 0
        ? 0
        : Math.round((dbStore.billingPayments.filter((item) => item.status === 'FAILED').length / dbStore.billingPayments.length) * 1000) / 10,
    };
  }

  private inferPlanFromPayment(amount: number) {
    const match = Object.entries(INR_PLAN_PRICE_BY_CODE).find(([, price]) => Math.abs(price - amount) < 100);
    const code = match?.[0] || (amount > 0 ? 'STARTER' : 'FREE');
    const names: Record<string, string> = {
      FREE: 'Free',
      STARTER: 'Starter',
      PRO: 'Pro',
      BUSINESS: 'Business',
      ENTERPRISE: 'Enterprise',
    };
    return {
      code,
      name: names[code] || 'Custom',
      price: INR_PLAN_PRICE_BY_CODE[code] || amount,
    };
  }
}
