import { BadRequestException } from '@nestjs/common';
import { PaymentProviderType } from '../enums/billing.enums';
import { PLATFORM_CURRENCY } from '../../../common/constants/currency';

export class PaymentProviderRouter {
  resolve(input: { country?: string; currency: string; paymentType: 'ORDER' | 'SUBSCRIPTION' }) {
    const currency = input.currency.toUpperCase();
    // PartnerIQ processes INR only — reject anything else at the payment-routing boundary
    // rather than silently falling back to a default provider for an unsupported currency.
    if (currency !== PLATFORM_CURRENCY) {
      throw new BadRequestException(`Only ${PLATFORM_CURRENCY} is supported for payments.`);
    }
    return (process.env.PAYMENT_DEFAULT_PROVIDER as PaymentProviderType) || PaymentProviderType.RAZORPAY;
  }
}
