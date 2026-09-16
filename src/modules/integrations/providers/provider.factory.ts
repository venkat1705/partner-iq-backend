import { Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationProvider } from './provider.interface';
import { HubSpotProvider } from './hubspot.provider';
import { ZohoCrmProvider } from './zoho-crm.provider';
import { RazorpayProvider } from './razorpay.provider';
import { CashfreeProvider } from './cashfree.provider';

@Injectable()
export class IntegrationProviderFactory {
  private readonly providers: Map<string, IntegrationProvider> = new Map();

  constructor(
    private readonly hubspotProvider: HubSpotProvider,
    private readonly zohoCrmProvider: ZohoCrmProvider,
    private readonly razorpayProvider: RazorpayProvider,
    private readonly cashfreeProvider: CashfreeProvider,
  ) {
    this.register(this.hubspotProvider);
    this.register(this.zohoCrmProvider);
    this.register(this.razorpayProvider);
    this.register(this.cashfreeProvider);
  }

  private register(provider: IntegrationProvider) {
    this.providers.set(provider.provider.toUpperCase(), provider);
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

