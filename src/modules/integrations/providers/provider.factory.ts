import { Inject, Injectable, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import { IntegrationProvider } from './provider.interface';
import { HubSpotProvider } from './hubspot.provider';
import { ZohoCrmProvider } from './zoho-crm.provider';
import { RazorpayProvider } from './razorpay.provider';
import { CashfreeProvider } from './cashfree.provider';

@Injectable()
export class IntegrationProviderFactory {
  private readonly providers: Map<string, IntegrationProvider> = new Map();

  constructor(
    @Optional() @Inject(forwardRef(() => HubSpotProvider)) private readonly hubspotProvider?: HubSpotProvider,
    @Optional() @Inject(forwardRef(() => ZohoCrmProvider)) private readonly zohoCrmProvider?: ZohoCrmProvider,
    @Optional() @Inject(forwardRef(() => RazorpayProvider)) private readonly razorpayProvider?: RazorpayProvider,
    @Optional() @Inject(forwardRef(() => CashfreeProvider)) private readonly cashfreeProvider?: CashfreeProvider,
  ) {
    if (this.hubspotProvider) this.register(this.hubspotProvider);
    if (this.zohoCrmProvider) this.register(this.zohoCrmProvider);
    if (this.razorpayProvider) this.register(this.razorpayProvider);
    if (this.cashfreeProvider) this.register(this.cashfreeProvider);
  }

  private register(provider?: IntegrationProvider) {
    if (provider?.provider) {
      this.providers.set(provider.provider.toUpperCase(), provider);
    }
  }

  getProvider(key: string): IntegrationProvider {
    const normalized = key.toUpperCase().replace(/-/g, '_');
    const provider = this.providers.get(normalized);
    if (!provider) {
      throw new NotFoundException(`No integration provider adapter found for: ${key}`);
    }
    return provider;
  }

  hasProvider(key: string): boolean {
    const normalized = key.toUpperCase().replace(/-/g, '_');
    return this.providers.has(normalized);
  }
}

