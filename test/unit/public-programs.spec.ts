import { describe, it, expect } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { AffiliatePortalController } from '../../src/modules/affiliates/affiliate-portal.controller';
import { ProgramStatus } from '../../src/common/enums';

/**
 * The shared public-program mapper (mapProgramForPublic) backs both the marketplace
 * list (GET /public/programs) and the detail endpoint (GET /public/programs/:id), so
 * this exercises it directly rather than through the full endpoint — those endpoints
 * call this.repositories(), which requires a real TypeORM DataSource and is
 * intentionally disallowed in this unit-test project (dbStore-only). The mapper
 * itself is a pure function of (program, orgs, branding, tiers, milestones).
 */
describe('mapProgramForPublic (public marketplace commission + featured + tier data)', () => {
  const controller = new AffiliatePortalController();
  // Private method — called the same way src/tests/affiliate-portal-data.test.ts
  // reaches AffiliatePortalController's other internal helpers.
  const map = (p: any, orgs: any[] = [], branding: Record<string, any> = {}, tiers: any[] = [], milestones: any[] = []) =>
    (controller as any).mapProgramForPublic(p, orgs, branding, tiers, milestones);

  function baseProgram(overrides: Record<string, any> = {}) {
    return {
      id: uuidv4(),
      organizationId: uuidv4(),
      name: 'Test Program',
      slug: 'test-program',
      status: ProgramStatus.ACTIVE,
      visibility: 'PUBLIC',
      commissionType: 'PERCENTAGE',
      defaultCommissionValue: 1500,
      affiliateApprovalMode: 'AUTO',
      cookieDurationDays: 30,
      ...overrides,
    };
  }

  it('reports 15% for a program stored at 1500 basis points', () => {
    const result = map(baseProgram({ defaultCommissionValue: 1500 }));
    expect(result.commissionValue).toBe(15);
    expect(result.commission).toContain('15%');
  });

  it('reports 0.5% for a sub-1% program instead of corrupting it to 50%', () => {
    // Regression test: defaultCommissionValue=50 previously rendered as "50%" because
    // of a buggy `rawVal >= 100 ? rawVal / 100 : rawVal` conditional in
    // affiliate-portal.controller.ts. The conversion is unconditional — 50 basis
    // points is always 0.5%, never 50%.
    const result = map(baseProgram({ defaultCommissionValue: 50 }));
    expect(result.commissionValue).toBe(0.5);
    expect(result.commission).toContain('0.5%');
  });

  it('formats a FIXED_AMOUNT program in currency, not percent', () => {
    const result = map(baseProgram({ commissionType: 'FIXED_AMOUNT', defaultCommissionValue: 50000 }));
    expect(result.commissionValue).toBe(500);
    expect(result.commissionType).toBe('flat');
    expect(result.commission).toContain('₹500');
  });

  it('never defaults featured to true for a program that never set it', () => {
    const result = map(baseProgram());
    expect(result.featured).toBe(false);
  });

  it('reflects featured:true only when the org actually set it', () => {
    const result = map(baseProgram({ featured: true }));
    expect(result.featured).toBe(true);
  });

  it('omits tierRewards (no generic placeholder copy) when no tiers/milestones exist', () => {
    const result = map(baseProgram());
    expect(result.tierRewards).toBeNull();
  });

  it('reports a real tier count in tierRewards when the org configured tiers', () => {
    const program = baseProgram();
    const tiers = [
      { id: uuidv4(), organizationId: program.organizationId, programId: program.id, name: 'Gold' },
      { id: uuidv4(), organizationId: program.organizationId, programId: null, name: 'Silver' },
    ];
    const result = map(program, [], {}, tiers, []);
    expect(result.tierRewards).toBe('2 Partner Tiers');
  });

  it('does not fabricate a brand logo when the org has none configured', () => {
    const result = map(baseProgram());
    expect(result.brandLogo).toBeNull();
  });
});
