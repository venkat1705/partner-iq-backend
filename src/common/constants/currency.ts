/**
 * PartnerIQ processes money in INR only, platform-wide. This is the single source of
 * truth — every DTO/service/schema default must reference this constant rather than a
 * hardcoded literal, so the currency policy can never drift out of sync across modules.
 */
export const PLATFORM_CURRENCY = 'INR' as const;
