import { describe, it, expect } from '@jest/globals';
import { SecurityUtils } from '../../src/common/utils/security.utils';

describe('MFA Security', () => {
  it('generates valid TOTP secret, codes, and recovery codes', () => {
    const setup = SecurityUtils.generateTotpSecret('PartnerIQ:user@example.test');
    const counter = Math.floor(Date.now() / 30000);
    const code = SecurityUtils.generateTotpCode(setup.secret, counter);
    const valid = SecurityUtils.verifyTotpCode(setup.secret, code);
    const invalid = SecurityUtils.verifyTotpCode(setup.secret, '000000');
    const recovered = SecurityUtils.generateRecoveryCodes(10);

    expect(setup.otpauthUri.startsWith('otpauth://totp/')).toBe(true);
    expect(setup.secret).toBeTruthy();
    expect(/^[A-Z2-7]+=*$/.test(setup.secret)).toBe(true);
    expect(valid).toBe(true);
    expect(invalid).toBe(false);
    expect(recovered.length).toBe(10);
    expect(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(recovered[0])).toBe(true);
  });
});

