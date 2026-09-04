import { SetMetadata } from '@nestjs/common';

export const STEP_UP_KEY = 'requireStepUp';

export interface StepUpOptions {
  maxAgeSeconds?: number;
}

/**
 * Decorator that requires recent MFA verification (step-up authentication).
 * Apply to sensitive controller endpoints.
 *
 * @example
 * @RequireStepUpMfa({ maxAgeSeconds: 600 })
 * @Post('change-payout-account')
 * async changePayoutAccount() { ... }
 */
export const RequireStepUpMfa = (options: StepUpOptions = {}) =>
  SetMetadata(STEP_UP_KEY, { maxAgeSeconds: options.maxAgeSeconds ?? 600 });
