/**
 * Program Default Tracking Links — the "View Links" flow's backend contract:
 * one auto-generated canonical link per (affiliate, program), idempotent
 * get-or-create, race-safe under concurrency, and strictly scoped to the
 * authenticated affiliate's own organization/program/link data.
 *
 * Exercises AffiliatePortalController directly against the real database
 * (same style as attribution-e2e.test.ts), bypassing the HTTP/guard layer —
 * JwtAuthGuard enforcement itself is declarative (@UseGuards) and covered by
 * the fact that every method here derives identity exclusively from the
 * `req.user` passed in; there is no organizationId/affiliateId parameter
 * anywhere in these endpoints for a caller to override.
 *
 *   npx tsx src/tests/program-default-links.test.ts
 */
import { v4 as uuidv4 } from 'uuid';
import { runSeed } from './helpers/test-seed';
import { initializeDataSource } from '../database/data-source';
import { Program, Affiliate, ProgramAffiliate, TrackingLink } from '../database/schema';
import { AffiliatePortalController } from '../modules/affiliates/affiliate-portal.controller';
import { AffiliateStatus, ProgramStatus } from '../common/enums';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}`, detail ?? '');
    failed++;
  }
}

async function assertThrows(fn: () => Promise<unknown>, name: string, expectedStatus?: number) {
  try {
    await fn();
    assert(false, name, 'did not throw');
  } catch (err: any) {
    const status = typeof err?.getStatus === 'function' ? err.getStatus() : err?.status;
    const ok = expectedStatus === undefined || status === expectedStatus;
    assert(ok, name, { expectedStatus, actualStatus: status, message: err?.message });
  }
}

async function main() {
  console.log('\n🔗 Program Default Tracking Links Suite\n');

  const { org } = await runSeed();
  const dataSource = await initializeDataSource();
  const programsRepo = dataSource.getRepository(Program);
  const affiliatesRepo = dataSource.getRepository(Affiliate);
  const programAffiliatesRepo = dataSource.getRepository(ProgramAffiliate);
  const trackingLinksRepo = dataSource.getRepository(TrackingLink);

  const controller = new AffiliatePortalController();

  const makeProgram = (overrides: Partial<Program> = {}) =>
    programsRepo.save(
      programsRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        name: 'Suite Program',
        slug: `suite-program-${uuidv4()}`,
        status: ProgramStatus.ACTIVE,
        landingUrl: 'https://acme.example.com/partners',
        createdBy: org.createdBy || uuidv4(),
        ...overrides,
      }),
    );

  const makeAffiliate = (overrides: Partial<Affiliate> = {}) =>
    affiliatesRepo.save(
      affiliatesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        displayName: 'Suite Affiliate',
        email: `suite-aff-${uuidv4()}@example.com`,
        status: AffiliateStatus.ACTIVE,
        ...overrides,
      }),
    );

  const makeMembership = (
    program: Program,
    affiliate: Affiliate,
    overrides: Partial<ProgramAffiliate> = {},
  ) =>
    programAffiliatesRepo.save(
      programAffiliatesRepo.create({
        id: uuidv4(),
        organizationId: org.id,
        programId: program.id,
        affiliateId: affiliate.id,
        status: AffiliateStatus.ACTIVE,
        referralCode: `ref-${uuidv4().slice(0, 8)}`,
        joinedAt: new Date(),
        ...overrides,
      }),
    );

  const reqFor = (affiliate: Affiliate) => ({ user: { email: affiliate.email, userId: affiliate.userId } });

  // ── Link generation: creates once, retrieves thereafter ──────────────────
  {
    const program = await makeProgram();
    const affiliate = await makeAffiliate();
    await makeMembership(program, affiliate);
    const req = reqFor(affiliate);

    const created = await controller.createProgramLink(req, program.id, undefined);
    assert(created.success === true && created.data.links.length === 1, 'POST generates a link on first call', created);
    const link = created.data.links[0];
    assert(!!link.trackingUrl && link.trackingUrl.includes('/r/'), 'Response includes a resolvable /r/:shortCode tracking URL', link);
    assert(!link.trackingUrl.includes(affiliate.email) && !link.destinationUrl.includes(affiliate.email), 'No email address leaked into the link');
    assert(!/^\d+$/.test((link.trackingUrl.split('/r/')[1] || '')), 'Short code is not a bare sequential/numeric id', link.trackingUrl);

    const repeat = await controller.createProgramLink(req, program.id, undefined);
    assert(repeat.data.links[0].id === link.id, 'Repeated POST (no Idempotency-Key) returns the same link, not a new one', repeat);

    const rowCount = await trackingLinksRepo.count({
      where: { organizationId: org.id, programId: program.id, affiliateId: affiliate.id, linkKind: 'PROGRAM_DEFAULT' },
    });
    assert(rowCount === 1, 'Exactly one PROGRAM_DEFAULT row exists for this affiliate+program', rowCount);

    const fetched = await controller.getProgramLinks(req, program.id);
    assert(fetched.data.links[0]?.id === link.id, 'GET retrieves the same link without generating another', fetched);
  }

  // ── Concurrency: simultaneous POSTs never create two rows ─────────────────
  {
    const program = await makeProgram();
    const affiliate = await makeAffiliate();
    await makeMembership(program, affiliate);
    const req = reqFor(affiliate);

    const [a, b, c] = await Promise.all([
      controller.createProgramLink(req, program.id, undefined),
      controller.createProgramLink(req, program.id, undefined),
      controller.createProgramLink(req, program.id, undefined),
    ]);
    const ids = new Set([a.data.links[0].id, b.data.links[0].id, c.data.links[0].id]);
    assert(ids.size === 1, 'Three concurrent POSTs for the same affiliate+program all resolve to one link id', [...ids]);

    const rowCount = await trackingLinksRepo.count({
      where: { organizationId: org.id, programId: program.id, affiliateId: affiliate.id, linkKind: 'PROGRAM_DEFAULT' },
    });
    assert(rowCount === 1, 'Concurrent requests never produce a second row (DB unique-index race path)', rowCount);
  }

  // ── Idempotency-Key: replay vs. reuse-with-different-payload ─────────────
  {
    const programX = await makeProgram();
    const programY = await makeProgram();
    const affiliate = await makeAffiliate();
    await makeMembership(programX, affiliate);
    await makeMembership(programY, affiliate);
    const req = reqFor(affiliate);
    const key = `idem-${uuidv4()}`;

    const first = await controller.createProgramLink(req, programX.id, key);
    const replay = await controller.createProgramLink(req, programX.id, key);
    assert(first.data.links[0].id === replay.data.links[0].id, 'Same Idempotency-Key + same request returns the cached response', replay);

    const rowCount = await trackingLinksRepo.count({
      where: { organizationId: org.id, programId: programX.id, affiliateId: affiliate.id, linkKind: 'PROGRAM_DEFAULT' },
    });
    assert(rowCount === 1, 'A replayed Idempotency-Key never creates a second idempotency record or link', rowCount);

    await assertThrows(
      () => controller.createProgramLink(req, programY.id, key),
      'Same Idempotency-Key reused for a materially different request (different program) is rejected as a conflict',
      409,
    );

    await assertThrows(
      () => controller.createProgramLink(req, programX.id, 'short'),
      'A malformed (too-short) Idempotency-Key is rejected',
      400,
    );
  }

  // ── Tenant / affiliate isolation ──────────────────────────────────────────
  {
    const program = await makeProgram();
    const affiliateA = await makeAffiliate({ displayName: 'Affiliate A' });
    const affiliateB = await makeAffiliate({ displayName: 'Affiliate B' });
    await makeMembership(program, affiliateA);
    await makeMembership(program, affiliateB);

    const createdA = await controller.createProgramLink(reqFor(affiliateA), program.id, undefined);
    const linkAId = createdA.data.links[0].id;

    const bBeforeGenerating = await controller.getProgramLinks(reqFor(affiliateB), program.id);
    assert(
      bBeforeGenerating.data.links.length === 0,
      "Affiliate B's GET never surfaces affiliate A's link, even for the same program",
      bBeforeGenerating,
    );

    const createdB = await controller.createProgramLink(reqFor(affiliateB), program.id, undefined);
    assert(createdB.data.links[0].id !== linkAId, 'Affiliate B generates their own distinct link, not A\'s', createdB);

    const aAfterBGenerated = await controller.getProgramLinks(reqFor(affiliateA), program.id);
    assert(
      aAfterBGenerated.data.links.length === 1 && aAfterBGenerated.data.links[0].id === linkAId,
      "Affiliate A still only ever sees their own link, not B's",
      aAfterBGenerated,
    );
  }

  // ── Cross-organization / nonexistent program ──────────────────────────────
  {
    const foreignOrgId = uuidv4();
    const foreignProgram = await makeProgram({ organizationId: foreignOrgId, createdBy: uuidv4() });
    const affiliate = await makeAffiliate();

    await assertThrows(
      () => controller.getProgramLinks(reqFor(affiliate), foreignProgram.id),
      "A program that exists but belongs to an organization the affiliate has no relationship with is denied, not returned",
      403,
    );

    await assertThrows(
      () => controller.getProgramLinks(reqFor(affiliate), uuidv4()),
      'A nonexistent programId is rejected as not found',
      404,
    );
  }

  // ── Approval / status gating ──────────────────────────────────────────────
  {
    const program = await makeProgram();
    const pendingAffiliate = await makeAffiliate();
    await makeMembership(program, pendingAffiliate, { status: AffiliateStatus.PENDING });

    await assertThrows(
      () => controller.createProgramLink(reqFor(pendingAffiliate), program.id, undefined),
      'A pending (not yet approved) affiliate cannot generate a program link',
      403,
    );

    const pausedProgram = await makeProgram({ status: ProgramStatus.PAUSED });
    const activeAffiliate = await makeAffiliate();
    await makeMembership(pausedProgram, activeAffiliate);

    await assertThrows(
      () => controller.createProgramLink(reqFor(activeAffiliate), pausedProgram.id, undefined),
      'A paused (inactive) program rejects link generation',
      400,
    );
  }

  console.log('\n' + '='.repeat(60));
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log('='.repeat(60));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Program Default Links suite failed:', err);
  process.exitCode = 1;
});
