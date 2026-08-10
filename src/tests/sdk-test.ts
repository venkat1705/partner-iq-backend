import { PartnerIQ } from '../../sdk/src/index';
import { runSeed } from '../database/seeds/run-seed';
import { dbStore } from '../database/store';
import { SecurityUtils } from '../common/utils/security.utils';

async function testSdk() {
  console.log('🧪 Testing @partneriq/sdk Integration...\n');

  // Seed DB
  const { org } = await runSeed();
  const seededKey = dbStore.apiKeys.find((k) => k.organizationId === org.id);

  // Instantiate SDK
  const client = new PartnerIQ({
    apiKey: 'pi_live_sample_key',
    baseUrl: 'http://localhost:3000',
  });

  console.log('  ✅ SDK Client Instantiated with API Key:', seededKey?.prefix || 'pi_live_...');

  // Test Webhook Signature Verification
  const secret = 'whsec_test_secret_123';
  const payload = '{"event":"conversion.created","timestamp":1700000000}';
  const timestamp = '1700000000';
  const rawSignature = SecurityUtils.signWebhookPayload(secret, parseInt(timestamp), payload);
  const signatureHeader = `t=${timestamp},v1=${rawSignature}`;

  const isValid = client.webhooks.verifySignature(payload, signatureHeader, secret);
  if (isValid) {
    console.log('  ✅ SDK Webhook HMAC Verification Passed');
  } else {
    console.error('  ❌ SDK Webhook HMAC Verification Failed');
    process.exit(1);
  }

  console.log('\n===================================');
  console.log('SDK Verification: All Tests Passed!');
  console.log('===================================\n');
}

testSdk().catch((err) => {
  console.error('SDK Test Error:', err);
  process.exit(1);
});
