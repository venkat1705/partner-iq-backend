import { PaymentProviderType } from '../enums/billing.enums';

export class PaymentProviderRouter {
  resolve(input: { country?: string; currency: string; paymentType: 'ORDER' | 'SUBSCRIPTION' }) {
    const currency = input.currency.toUpperCase();
    if (currency === 'INR') return PaymentProviderType.RAZORPAY;
    if (['USD', 'EUR', 'GBP'].includes(currency)) {
      return (process.env.PAYMENT_DEFAULT_PROVIDER as PaymentProviderType) || PaymentProviderType.RAZORPAY;
    }
    return (process.env.PAYMENT_DEFAULT_PROVIDER as PaymentProviderType) || PaymentProviderType.RAZORPAY;
  }
}
