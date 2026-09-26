import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AppDataSource } from '../database/data-source';
import { PlatformGovernanceService } from '../modules/admin/governance/governance.service';
import type { AuthUserPayload } from '../common/interfaces/request-with-user.interface';

describe('Platform Governance Operations & Policy Engine Test Suite', () => {
  let governanceService: PlatformGovernanceService;

  const adminRequester: AuthUserPayload = {
    userId: '00000000-0000-0000-0000-000000000001',
    email: 'admin.requester@partneriq.in',
    isSuperAdmin: true,
  };

  const secondaryApprover: AuthUserPayload = {
    userId: '00000000-0000-0000-0000-000000000002',
    email: 'secondary.approver@partneriq.in',
    isSuperAdmin: true,
  };

  before(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    governanceService = new PlatformGovernanceService();
    await governanceService.ensureBaselineSeeding();
  });

  it('1. should evaluate real platform governance status and return complete protection matrix', async () => {
    const overview = await governanceService.getOverview();
    assert.ok(overview);
    assert.ok(['Healthy', 'Attention Required', 'Restricted', 'Configuration Incomplete'].includes(overview.globalStatus));
    assert.equal(overview.protectionMatrix.tenantIsolation, 'Protected');
    assert.equal(overview.protectionMatrix.adminAuthentication, 'Protected');
    assert.ok(overview.policyCoverage.totalPolicies >= 12);
    assert.ok(overview.privilegedOperations.totalProtected >= 16);
  });

  it('2. should list all baseline policies and allow filtering by category', async () => {
    const list = await governanceService.listPolicies();
    assert.ok(list.total >= 12);

    const tenantList = await governanceService.listPolicies({ category: 'TENANT_ISOLATION' });
    assert.ok(tenantList.items.length >= 1);
    assert.equal(tenantList.items[0].key, 'tenant.isolation.strict');
  });

  it('3. should update policy and automatically generate a version snapshot with diff', async () => {
    const policy = await governanceService.getPolicy('tenant.isolation.strict');
    assert.ok(policy);
    const initialVersion = policy.policy.currentVersion;

    const updated = await governanceService.updatePolicy(
      'tenant.isolation.strict',
      {
        description: 'Updated description for multi-tenant strict isolation test',
        changeReason: 'Automated test suite policy update',
      },
      adminRequester,
    );

    assert.equal(updated.currentVersion, initialVersion + 1);

    const reloaded = await governanceService.getPolicy('tenant.isolation.strict');
    assert.equal(reloaded.versions.length, initialVersion + 1);
    assert.equal(reloaded.versions[0].version, initialVersion + 1);
    assert.equal(reloaded.versions[0].changeReason, 'Automated test suite policy update');
  });

  it('4. should create a governance approval request for a sensitive action', async () => {
    const req = await governanceService.createApprovalRequest(
      {
        actionKey: 'payout.override_hold',
        title: 'Payout Compliance Hold Override Batch #TEST-1',
        description: 'Requested by billing team for partner enterprise payout',
        riskLevel: 'CRITICAL',
        actionPayload: { batchId: 'batch-test-123', amountUsd: 15000 },
      },
      adminRequester,
    );

    assert.ok(req.id);
    assert.equal(req.status, 'PENDING');
    assert.equal(req.requestedBy, adminRequester.userId);
  });

  it('5. should strictly enforce Four-Eyes Principle and reject self-approval by requester', async () => {
    const requests = await governanceService.listApprovals({ status: 'PENDING' });
    const target = requests.find((r) => r.requestedBy === adminRequester.userId);
    assert.ok(target, 'Should find a pending request created by adminRequester');

    await assert.rejects(
      async () => {
        await governanceService.approveRequest(target.id, adminRequester, 'Attempting self approval');
      },
      (err: any) => {
        assert.match(err.message, /Four-Eyes Principle/i);
        return true;
      },
    );
  });

  it('6. should allow a legitimate secondary administrator to approve the request', async () => {
    const requests = await governanceService.listApprovals({ status: 'PENDING' });
    const target = requests.find((r) => r.requestedBy === adminRequester.userId);
    assert.ok(target);

    const approved = await governanceService.approveRequest(
      target.id,
      secondaryApprover,
      'Approved after KYC and dual review',
    );

    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.approverId, secondaryApprover.userId);
    assert.equal(approved.approverEmail, secondaryApprover.email);
  });

  it('7. should create, validate, and revoke a scoped time-bound exception', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const exception = await governanceService.createException(
      {
        policyKey: 'financial.commission.rate_cap',
        scope: 'AFFILIATE_TIER_BLACK',
        reason: 'Temporary exception for Black Tier influencer Q4 campaign',
        expiresAt: futureDate,
      },
      adminRequester,
    );

    assert.ok(exception.id);
    assert.equal(exception.status, 'ACTIVE');

    const revoked = await governanceService.revokeException(exception.id, secondaryApprover);
    assert.equal(revoked.status, 'REVOKED');
  });

  it('8. should toggle an emergency control with mandatory justification and update overview', async () => {
    const control = await governanceService.toggleEmergencyControl(
      'ADMIN_OPERATIONS_FREEZE',
      {
        enabled: true,
        reason: 'Security drill and resilience testing window',
      },
      adminRequester,
    );

    assert.equal(control.enabled, true);

    const overview = await governanceService.getOverview();
    assert.equal(overview.globalStatus, 'Restricted');
    assert.ok(overview.emergencyControlsActive.some((c) => c.controlKey === 'ADMIN_OPERATIONS_FREEZE'));

    // Disable emergency freeze
    const restored = await governanceService.toggleEmergencyControl(
      'ADMIN_OPERATIONS_FREEZE',
      {
        enabled: false,
        reason: 'Security drill complete',
      },
      secondaryApprover,
    );
    assert.equal(restored.enabled, false);
  });
});

