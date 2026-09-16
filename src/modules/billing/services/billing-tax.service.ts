import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';

export const BILLING_TAX_SETTING_KEY = 'billing.tax';

export interface BillingTaxConfig {
  /** Tax rate in basis points — 1800 = 18.00% GST. Integer, so no float drift. */
  rateBasisPoints: number;
  label: string;
  enabled: boolean;
}

const DEFAULT_TAX: BillingTaxConfig = {
  rateBasisPoints: 1800,
  label: 'GST (18%)',
  enabled: true,
};

/**
 * Server-side tax configuration for subscription and add-on billing.
 *
 * The rate lives in `platform_settings` so PartnerIQ admins can change it
 * without a deploy, and is expressed in basis points so every amount stays in
 * integer minor units — no floating point touches a monetary value.
 */
@Injectable()
export class BillingTaxService {
  getConfig(): BillingTaxConfig {
    const setting = dbStore.platformSettings.find((item) => item.key === BILLING_TAX_SETTING_KEY);
    if (!setting?.value) return { ...DEFAULT_TAX };
    const value = setting.value as Partial<BillingTaxConfig>;
    return {
      rateBasisPoints: Number.isInteger(value.rateBasisPoints)
        ? (value.rateBasisPoints as number)
        : DEFAULT_TAX.rateBasisPoints,
      label: value.label || DEFAULT_TAX.label,
      enabled: value.enabled ?? DEFAULT_TAX.enabled,
    };
  }

  setConfig(config: Partial<BillingTaxConfig>, actorId: string): BillingTaxConfig {
    const next: BillingTaxConfig = { ...this.getConfig(), ...config };
    let setting = dbStore.platformSettings.find((item) => item.key === BILLING_TAX_SETTING_KEY);
    if (!setting) {
      setting = {
        id: uuidv4(),
        key: BILLING_TAX_SETTING_KEY,
        value: next,
        description: 'Tax applied to PartnerIQ subscription and add-on charges',
        updatedBy: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      dbStore.platformSettings.push(setting as any);
    } else {
      setting.value = next;
      setting.updatedBy = actorId;
      setting.updatedAt = new Date();
    }
    return next;
  }

  /**
   * Tax on an amount in minor units. Rounds half-up on the final paisa, which
   * is what Indian invoicing expects.
   */
  calculate(amountMinor: number): { taxMinor: number; label: string; rateBasisPoints: number } {
    const config = this.getConfig();
    if (!config.enabled || config.rateBasisPoints <= 0 || amountMinor <= 0) {
      return { taxMinor: 0, label: config.label, rateBasisPoints: config.rateBasisPoints };
    }
    const taxMinor = Math.round((amountMinor * config.rateBasisPoints) / 10_000);
    return { taxMinor, label: config.label, rateBasisPoints: config.rateBasisPoints };
  }
}
