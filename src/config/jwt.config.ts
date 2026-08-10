export interface JwtConfig {
  accessSecret: string;
  accessTtl: string;
  refreshSecret: string;
  refreshTtl: string;
  passwordResetTtl: string;
  emailVerificationTtl: string;
}

export const getJwtConfig = (): JwtConfig => {
  const accessSecret = process.env.JWT_ACCESS_SECRET || 'partneriq_super_secret_jwt_access_key_min_32_chars';
  const refreshSecret = process.env.JWT_REFRESH_SECRET || 'partneriq_super_secret_jwt_refresh_key_min_32_chars';

  if (process.env.NODE_ENV === 'production') {
    if (accessSecret.length < 32 || refreshSecret.length < 32) {
      throw new Error('JWT secrets must have a minimum length of 32 characters in production.');
    }
  }

  return {
    accessSecret,
    accessTtl: process.env.JWT_ACCESS_TTL || '30s',
    refreshSecret,
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    passwordResetTtl: process.env.PASSWORD_RESET_TTL || '15m',
    emailVerificationTtl: process.env.EMAIL_VERIFICATION_TTL || '24h',
  };
};
