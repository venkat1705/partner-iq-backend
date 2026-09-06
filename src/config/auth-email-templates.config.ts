/**
 * Single source of truth for System & Authentication Email Template IDs.
 *
 * Update or override template IDs here (or via environment variables)
 * to easily replace templates across the entire backend.
 */

export const AUTH_EMAIL_TEMPLATES = {
  /**
   * Template used when a user or affiliate requests a password reset link
   */
  PASSWORD_RESET: process.env.EMAIL_TEMPLATE_PASSWORD_RESET || 'custom-template-mtp9u865',

  /**
   * Template used when a password was successfully changed
   */
  PASSWORD_CHANGED: process.env.EMAIL_TEMPLATE_PASSWORD_CHANGED || 'SECURITY_PASSWORD_CHANGED',

  /**
   * Template used when an account email verification is dispatched
   */
  EMAIL_VERIFICATION: process.env.EMAIL_TEMPLATE_EMAIL_VERIFICATION || 'SECURITY_EMAIL_VERIFICATION',

  /**
   * Template used for new device or unknown location login alerts
   */
  NEW_LOGIN_ALERT: process.env.EMAIL_TEMPLATE_NEW_LOGIN || 'SECURITY_NEW_LOGIN',

  /**
   * Template used when Two-Factor Authentication is enabled
   */
  TWO_FACTOR_ENABLED: process.env.EMAIL_TEMPLATE_2FA_ENABLED || 'SECURITY_TWO_FACTOR_ENABLED',

  /**
   * Template used when Two-Factor Authentication is disabled
   */
  TWO_FACTOR_DISABLED: process.env.EMAIL_TEMPLATE_2FA_DISABLED || 'SECURITY_TWO_FACTOR_DISABLED',

  /**
   * Template used for organization invitations
   */
  ORGANIZATION_INVITATION: process.env.EMAIL_TEMPLATE_ORG_INVITATION || 'ORGANIZATION_MEMBER_INVITED',

  /**
   * Template used for affiliate welcome
   */
  AFFILIATE_WELCOME: process.env.EMAIL_TEMPLATE_AFFILIATE_WELCOME || 'AFFILIATE_WELCOME',
} as const;

export type AuthEmailTemplateType = keyof typeof AUTH_EMAIL_TEMPLATES;

export function getAuthEmailTemplateId(type: AuthEmailTemplateType): string {
  return AUTH_EMAIL_TEMPLATES[type];
}

