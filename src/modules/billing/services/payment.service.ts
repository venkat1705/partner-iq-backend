import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { PaymentProviderType, PaymentStatus } from '../enums/billing.enums';
import { PaymentProviderFactory } from '../providers/payment-provider.factory';

@Injectable()
export class PaymentService {
  constructor(private readonly providerFactory: PaymentProviderFactory) {}

  list(organizationId: string) {
    return dbStore.billingPayments
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime());
  }

  async refund(organizationId: string, userId: string, paymentId: string, amount?: number) {
    const payment = dbStore.billingPayments.find((item) => item.id === paymentId && item.organizationId === organizationId);
    if (!payment?.providerPaymentId) {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' });
    }
    if (amount && amount > payment.amount) {
      throw new BadRequestException({ code: 'INVALID_REFUND_AMOUNT', message: 'Refund amount cannot exceed payment amount.' });
    }
    const provider = this.providerFactory.getProvider(payment.provider as PaymentProviderType);
    const providerRefund = await provider.refundPayment(payment.providerPaymentId, amount);
    const refund = {
      id: uuidv4(),
      organizationId,
      paymentId: payment.id,
      provider: payment.provider,
      providerRefundId: providerRefund.id,
      amount: providerRefund.amount,
      currency: payment.currency,
      status: providerRefund.status.toUpperCase(),
      createdBy: userId,
      createdDate: new Date(),
      modifiedDate: new Date(),
    };
    dbStore.billingRefunds.push(refund as any);
    payment.status = amount && amount < payment.amount ? PaymentStatus.PARTIALLY_REFUNDED : PaymentStatus.REFUNDED;
    payment.modifiedDate = new Date();
    return refund;
  }
}
