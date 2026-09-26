import { FeatureFlagsService } from '../modules/admin/feature-flags/feature-flags.service';

async function runTests() {
  console.log('🧪 Starting Feature Flags System Verification Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  const service = new FeatureFlagsService();

  // Test 1: Seed flags loaded
  const overview = service.getOverview('PRODUCTION');
  assert(overview.kpi.totalFlags >= 6, 'Seed flags loaded in database registry');

  // Test 2: Deterministic Bucketing Stability
  const bucket1 = service.getBucketValue('affiliate.analytics.v2', 'org_12345');
  const bucket2 = service.getBucketValue('affiliate.analytics.v2', 'org_12345');
  const bucket3 = service.getBucketValue('affiliate.analytics.v2', 'org_12345');
  assert(
    bucket1 === bucket2 && bucket2 === bucket3 && bucket1 >= 0 && bucket1 < 100,
    `Deterministic bucketing is 100% stable across calls (Bucket: ${bucket1})`
  );

  // Test 3: Key Validation (Lowercase dot-separated only)
  let threwInvalidKey = false;
  try {
    service.createFlag({
      key: 'Invalid_Key_Name!',
      name: 'Bad Flag',
    });
  } catch (err: any) {
    threwInvalidKey = true;
  }
  assert(threwInvalidKey, 'Rejects invalid non-dot-separated or uppercase keys');

  // Test 4: Environment Isolation
  const devEval = service.evaluate('payouts.instant-settlement', { environment: 'DEVELOPMENT' });
  const prodEval = service.evaluate('payouts.instant-settlement', { environment: 'PRODUCTION' });
  assert(
    devEval.enabled === true && prodEval.enabled === false,
    'Environment isolation: payouts.instant-settlement is ON in DEV and OFF in PROD'
  );

  // Test 5: Multi-Tenant Organization Override
  const orgEval = service.evaluate('affiliate.analytics.v2', {
    environment: 'PRODUCTION',
    organizationId: 'org_acme_corp',
  });
  assert(
    orgEval.enabled === true && orgEval.source === 'OVERRIDE',
    'Organization override takes precedence over percentage rollout'
  );

  // Test 6: Priority Targeting Rules (Plan-based targeting)
  const enterpriseEval = service.evaluate('programs.new-builder', {
    environment: 'PRODUCTION',
    plan: 'enterprise',
  });
  const starterEval = service.evaluate('programs.new-builder', {
    environment: 'PRODUCTION',
    plan: 'starter',
    organizationId: 'org_starter_test_bucket_99', // Ensure bucket >= 50
  });
  assert(
    enterpriseEval.enabled === true && enterpriseEval.source === 'RULE_MATCH',
    'Rule evaluation matches Enterprise plan condition'
  );

  // Test 7: Temporary Override Expiration
  service.setOverride('api.v2-endpoints', 'PRODUCTION', {
    subjectType: 'ORGANIZATION',
    subjectId: 'org_expired_test',
    value: 'true',
    expiresAt: new Date(Date.now() - 60000).toISOString(), // Expired 1 minute ago
    reason: 'Temporary test',
  });
  const expiredEval = service.evaluate('api.v2-endpoints', {
    environment: 'PRODUCTION',
    organizationId: 'org_expired_test',
  });
  assert(
    expiredEval.source !== 'OVERRIDE',
    'Expired overrides are safely ignored by the evaluation engine'
  );

  // Test 8: Emergency Kill Switch
  const killedFlag = service.emergencyKillSwitch(
    'fraud.advanced-detection',
    'Detected severe upstream false positive anomaly',
    'sec-ops-admin'
  );
  assert(killedFlag.status === 'DISABLED', 'Emergency kill switch immediately sets flag status to DISABLED');
  const postKillEval = service.evaluate('fraud.advanced-detection', { environment: 'PRODUCTION' });
  assert(
    postKillEval.enabled === false && postKillEval.source === 'KILL_SWITCH',
    'Post-kill evaluation immediately yields false with KILL_SWITCH source'
  );

  // Test 9: Configuration Rollback
  const flagDetail = service.getFlagById('fraud.advanced-detection');
  const version1 = flagDetail.versions.find((v) => v.version === 1);
  assert(version1 !== undefined, 'Version 1 initial snapshot exists in audit history');

  const rolledBack = service.rollbackToVersion(
    'fraud.advanced-detection',
    1,
    'Upstream anomaly resolved, restoring version 1',
    'recovery-admin'
  );
  assert(
    rolledBack.status === 'ACTIVE' && rolledBack.version > 2,
    `Rollback creates a new version (${rolledBack.version}) preserving historical lineage`
  );

  // Test 10: Batch Evaluation
  const batch = service.evaluateMany(
    ['affiliate.analytics.v2', 'programs.new-builder', 'billing.enterprise-contracts'],
    { environment: 'PRODUCTION', organizationId: 'org_acme_corp' }
  );
  assert(
    Object.keys(batch).length === 3 && batch['affiliate.analytics.v2'].enabled === true,
    'Batch evaluation returns structured results for all requested keys'
  );

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});

