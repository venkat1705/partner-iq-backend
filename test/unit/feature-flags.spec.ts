import { describe, it, expect, beforeEach } from '@jest/globals';
import { FeatureFlagsService } from '../../src/modules/admin/feature-flags/feature-flags.service';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;

  beforeEach(() => {
    service = new FeatureFlagsService();
    // The registry no longer auto-seeds fabricated sample flags on
    // construction; bootstrap the same baseline explicitly here so the
    // rest of this suite can exercise the real evaluation engine against a
    // known set of flags.
    service.seedDefaultFlagsIfEmpty();
  });

  it('loads baseline seed flags in registry', () => {
    const overview = service.getOverview('PRODUCTION');
    expect(overview.kpi.totalFlags).toBeGreaterThanOrEqual(6);
  });

  it('ensures deterministic bucketing stability', () => {
    const bucket1 = service.getBucketValue('affiliate.analytics.v2', 'org_12345');
    const bucket2 = service.getBucketValue('affiliate.analytics.v2', 'org_12345');
    const bucket3 = service.getBucketValue('affiliate.analytics.v2', 'org_12345');
    expect(bucket1).toBe(bucket2);
    expect(bucket2).toBe(bucket3);
    expect(bucket1).toBeGreaterThanOrEqual(0);
    expect(bucket1).toBeLessThan(100);
  });

  it('validates lowercase dot-separated key format', () => {
    expect(() => {
      service.createFlag({
        key: 'Invalid_Key_Name!',
        name: 'Bad Flag',
      });
    }).toThrow();
  });

  it('enforces environment isolation', () => {
    const devEval = service.evaluate('payouts.instant-settlement', { environment: 'DEVELOPMENT' });
    const prodEval = service.evaluate('payouts.instant-settlement', { environment: 'PRODUCTION' });
    expect(devEval.enabled).toBe(true);
    expect(prodEval.enabled).toBe(false);
  });

  it('prioritizes multi-tenant organization overrides', () => {
    service.setOverride('affiliate.analytics.v2', 'PRODUCTION', {
      subjectType: 'ORGANIZATION',
      subjectId: 'org_acme_corp',
      value: 'true',
      reason: 'Pilot customer program',
    });
    const orgEval = service.evaluate('affiliate.analytics.v2', {
      environment: 'PRODUCTION',
      organizationId: 'org_acme_corp',
    });
    expect(orgEval.enabled).toBe(true);
    expect(orgEval.source).toBe('OVERRIDE');
  });

  it('matches plan-based targeting rules', () => {
    const enterpriseEval = service.evaluate('programs.new-builder', {
      environment: 'PRODUCTION',
      plan: 'enterprise',
    });
    expect(enterpriseEval.enabled).toBe(true);
    expect(enterpriseEval.source).toBe('RULE_MATCH');
  });

  it('ignores expired temporary overrides', () => {
    service.setOverride('api.v2-endpoints', 'PRODUCTION', {
      subjectType: 'ORGANIZATION',
      subjectId: 'org_expired_test',
      value: 'true',
      expiresAt: new Date(Date.now() - 60000).toISOString(),
      reason: 'Temporary test',
    });
    const expiredEval = service.evaluate('api.v2-endpoints', {
      environment: 'PRODUCTION',
      organizationId: 'org_expired_test',
    });
    expect(expiredEval.source).not.toBe('OVERRIDE');
  });

  it('triggers emergency kill switch and supports configuration rollback', () => {
    const killedFlag = service.emergencyKillSwitch(
      'fraud.advanced-detection',
      'Detected severe upstream false positive anomaly',
      'sec-ops-admin'
    );
    expect(killedFlag.status).toBe('DISABLED');

    const postKillEval = service.evaluate('fraud.advanced-detection', { environment: 'PRODUCTION' });
    expect(postKillEval.enabled).toBe(false);
    expect(postKillEval.source).toBe('KILL_SWITCH');

    const flagDetail = service.getFlagById('fraud.advanced-detection');
    const version1 = flagDetail.versions.find((v) => v.version === 1);
    expect(version1).toBeDefined();

    const rolledBack = service.rollbackToVersion(
      'fraud.advanced-detection',
      1,
      'Upstream anomaly resolved, restoring version 1',
      'recovery-admin'
    );
    expect(rolledBack.status).toBe('ACTIVE');
    expect(rolledBack.version).toBeGreaterThan(2);
  });

  it('supports batch evaluations', () => {
    service.setOverride('affiliate.analytics.v2', 'PRODUCTION', {
      subjectType: 'ORGANIZATION',
      subjectId: 'org_acme_corp',
      value: 'true',
      reason: 'Batch evaluation pilot',
    });
    const batch = service.evaluateMany(
      ['affiliate.analytics.v2', 'programs.new-builder', 'billing.enterprise-contracts'],
      { environment: 'PRODUCTION', organizationId: 'org_acme_corp' }
    );
    expect(Object.keys(batch).length).toBe(3);
    expect(batch['affiliate.analytics.v2'].enabled).toBe(true);
  });
});

