import { IntegrationAdapter } from './integration-adapter';
import { BetaAdapter, ComingSoonAdapter, PaddleAdapter, StripeAdapter } from './provider-adapters';

export class IntegrationAdapterRegistry {
  private readonly adapters = new Map<string, IntegrationAdapter>();

  constructor() {
    [
      new StripeAdapter(),
      new PaddleAdapter(),
      new BetaAdapter('CHARGEBEE'),
      new BetaAdapter('SHOPIFY'),
      new BetaAdapter('WOOCOMMERCE'),
      new BetaAdapter('HUBSPOT'),
      new ComingSoonAdapter('SALESFORCE'),
      new ComingSoonAdapter('ZAPIER'),
      new ComingSoonAdapter('SLACK'),
      new ComingSoonAdapter('SEGMENT'),
      new BetaAdapter('PARTNERIQ_API'),
      new BetaAdapter('PARTNERIQ_WEBHOOKS'),
      new BetaAdapter('PARTNERIQ_NODE_SDK'),
      new BetaAdapter('PARTNERIQ_BROWSER_SDK'),
    ].forEach((adapter) => this.adapters.set(adapter.code, adapter));
  }

  get(code: string) {
    return this.adapters.get(code);
  }

  all() {
    return Array.from(this.adapters.values());
  }
}

export const integrationAdapterRegistry = new IntegrationAdapterRegistry();
