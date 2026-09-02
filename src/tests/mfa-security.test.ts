import { SecurityUtils } from '../common/utils/security.utils';

async function runMfaSecurityTests() {
  const setup = SecurityUtils.generateTotpSecret('PartnerIQ:user@example.com');
  const counter = Math.floor(Date.now() / 30000);
  const code = SecurityUtils.generateTotpCode(setup.secret, counter);
  const valid = SecurityUtils.verifyTotpCode(setup.secret, code);
  const invalid = SecurityUtils.verifyTotpCode(setup.secret, '000000');
  const recovered = SecurityUtils.generateRecoveryCodes(10);

  if (!setup.otpauthUri.startsWith('otpauth://totp/')) {
    throw new Error('OTPAUTH URI generation failed');
  }

  if (!setup.secret || !/^[A-Z2-7]+=*$/.test(setup.secret)) {
    throw new Error('TOTP secret is not valid base32');
  }

  if (!valid) {
    throw new Error('TOTP verification failed for valid code');
  }

  if (invalid) {
    throw new Error('TOTP verification incorrectly accepted invalid code');
  }

  if (recovered.length !== 10) {
    throw new Error('Recovery code generation length mismatch');
  }

  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(recovered[0])) {
    throw new Error('Recovery code format mismatch');
  }

  console.log('MFA security tests passed');
}

runMfaSecurityTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
