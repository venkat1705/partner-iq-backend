import { IntegrationAdapter } from './integration-adapter';
import { HubSpotAdapter } from './provider-adapters';

export class IntegrationAdapterRegistry {
  private readonly adapters = new Map<string, IntegrationAdapter>();

  constructor() {
    [new HubSpotAdapter()].forEach((adapter) => this.adapters.set(adapter.code, adapter));
  }

  get(code: string) {
    return this.adapters.get(code);
  }

  all() {
    return Array.from(this.adapters.values());
  }
}

export const integrationAdapterRegistry = new IntegrationAdapterRegistry();
