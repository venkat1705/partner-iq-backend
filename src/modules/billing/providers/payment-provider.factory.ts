import { Injectable } from '@nestjs/common';
import { PaymentProviderType } from '../enums/billing.enums';
import { RazorpayProvider } from './razorpay.provider';
import { PaymentProvider } from './payment-provider.interface';

@Injectable()
export class PaymentProviderFactory {
  constructor(private readonly razorpayProvider: RazorpayProvider) {}

  getProvider(provider: PaymentProviderType): PaymentProvider {
    const providers: Record<string, PaymentProvider> = {
      [PaymentProviderType.RAZORPAY]: this.razorpayProvider,
    };
    const resolved = providers[provider];
    if (!resolved) {
      throw new Error(`Payment provider ${provider} is not configured`);
    }
    return resolved;
  }
}
