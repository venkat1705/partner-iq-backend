import { AuthService } from '../modules/auth/auth.service';
import { RiskEngineService } from '../modules/auth/risk-engine.service';
import { SecurityUtils } from '../common/utils/security.utils';
import { runSeed } from './helpers/test-seed';
import { dbStore } from '../database/store';
import { AuthLevel, RiskLevel, SecurityEventType } from '../common/enums';
import { lookupIp, formatLocation } from '../common/utils/geo.utils';

async function runAuthSecurityTestSuite() {
  console.log('🧪 Running PartnerIQ Enterprise Auth & Security Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  try {
    // 1. Seed Initialization
    const { admin, adminPassword, org } = await runSeed();
    await dbStore.initialize();
    assert(!!admin && !!org, 'Seed Data Initialized');

    const riskEngine = new RiskEngineService();
    const authService = new AuthService(riskEngine);

    // 2. Risk Engine Evaluation Tests
    console.log('\n--- 1. Risk Engine Evaluation Tests ---');
    const lowRisk = riskEngine.evaluate({
      isNewDevice: false,
      isNewCountry: false,
      isKnownTrustedDevice: true,
      isPreviousKnownDevice: true,
      recentFailedAttempts: 0,
      refreshTokenReuseDetected: false,
      recentPasswordChange: false,
      recentMfaChange: false,
      organizationRequiresMfa: false,
      mfaEnabled: false,
    });
    assert(lowRisk.level === RiskLevel.LOW && !lowRisk.requiresMfa, 'Known Trusted Device -> Low Risk');

    const highRisk = riskEngine.evaluate({
      isNewDevice: true,
      isNewCountry: true,
      isKnownTrustedDevice: false,
      isPreviousKnownDevice: false,
      recentFailedAttempts: 4,
      refreshTokenReuseDetected: false,
      recentPasswordChange: false,
      recentMfaChange: false,
      organizationRequiresMfa: false,
      mfaEnabled: false,
    });
    assert(highRisk.score >= 60 && highRisk.requiresMfa, 'New Device + New Country + Failed Attempts -> High Risk & MFA Required');

    const criticalRisk = riskEngine.evaluate({
      isNewDevice: true,
      isNewCountry: true,
      isKnownTrustedDevice: false,
      isPreviousKnownDevice: false,
      recentFailedAttempts: 0,
      refreshTokenReuseDetected: true,
      recentPasswordChange: false,
      recentMfaChange: false,
      organizationRequiresMfa: false,
      mfaEnabled: false,
    });
    assert(criticalRisk.level === RiskLevel.CRITICAL && criticalRisk.blockLogin, 'Refresh Token Reuse -> Critical Risk & Block Login');

    // 3. TOTP Code Verification & Drift Window
    console.log('\n--- 2. TOTP Generation & Verification Tests ---');
    const { secret, otpauthUri, manualKey } = SecurityUtils.generateTotpSecret('test@partneriq.demo');
    assert(secret.length >= 16 && otpauthUri.startsWith('otpauth://totp/'), 'TOTP Secret & URI Generated');
    assert(manualKey === secret, 'Manual key matches secret');

    const currentTotpCode = SecurityUtils.generateTotpCode(secret);
    assert(currentTotpCode.length === 6, 'Generated 6-digit TOTP Code');
    assert(SecurityUtils.verifyTotpCode(secret, currentTotpCode), 'Valid TOTP Code Verification');

    const invalidTotpCode = '000000';
    assert(!SecurityUtils.verifyTotpCode(secret, invalidTotpCode), 'Invalid TOTP Code Rejected');

    // 4. Recovery Codes Generation & Hashing
    console.log('\n--- 3. Recovery Codes Security Tests ---');
    const recoveryCodes = SecurityUtils.generateRecoveryCodes(10);
    assert(recoveryCodes.length === 10, 'Generated 10 Recovery Codes');
    assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(recoveryCodes[0]), 'Recovery Code Format (XXXX-XXXX)');

    const hash1 = SecurityUtils.hashRecoveryCode(recoveryCodes[0]);
    const hash2 = SecurityUtils.hashRecoveryCode(recoveryCodes[0]);
    assert(hash1 === hash2, 'Recovery Code Hash Deterministic');
    assert(SecurityUtils.timingSafeCompare(hash1, hash2), 'Timing-Safe Comparison Verification');

    // 5. Geolocation Lookup
    console.log('\n--- 4. Geolocation Tests ---');
    const localLocation = await lookupIp('127.0.0.1');
    assert(localLocation === null, 'Localhost IP Returns Null (Private IP Filter)');

    const formattedLoc = formatLocation(null);
    assert(formattedLoc === 'Unknown location', 'Null Location Formatted Safely');

    // 6. Login & Session Security
    console.log('\n--- 5. Login & Session Lifecycle Tests ---');
    const loginRes = (await authService.login(
      { email: admin.email, password: adminPassword },
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '192.168.1.1',
    )) as any;

    assert(!!loginRes.accessToken && !!loginRes.sessionId, 'Login Succeeded & Session Created');

    const meRes = await authService.getMe(admin.id);
    assert(meRes.email === admin.email, 'GetMe Profile Returned');
    assert(meRes.mfa.enabled === false, 'MFA initially disabled for user');

    // 7. Device Listing
    const devices = await authService.getDevices(admin.id);
    assert(devices.length > 0 && devices[0].browser === 'Chrome', 'Device Parsed & Registered');

    // 8. Security Events Listing
    const eventsRes = await authService.getSecurityEvents(admin.id, 1, 10);
    assert(eventsRes.events.length > 0, 'Security Audit Events Logged');

  } catch (err: any) {
    console.error('Test Exception:', err);
    assert(false, `Test Suite Executed Without Exceptions: ${err.message}`);
  }

  console.log(`\n========================================`);
  console.log(`Summary: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthSecurityTestSuite();

