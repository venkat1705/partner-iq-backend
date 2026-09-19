import assert from 'assert';
import { dbStore } from '../database/store';
import { BlogsService } from '../modules/blogs/blogs.service';
import { AuditService } from '../modules/audit/audit.service';
import { AuditAction } from '../common/enums';

async function runBlogManagementTests() {
  console.log('🚀 Running Blog Management End-to-End Test Suite...\n');

  // 1. Initialize DB Store
  await dbStore.initialize();

  // Clean up test articles from previous runs to keep assertions deterministic
  const toRemove = dbStore.blogPosts.filter(
    (b) => b.title.includes('Acme Partner') || b.title.includes('Beta Tech') || b.title.includes('Platform Master Guide'),
  );
  for (const b of toRemove) {
    const idx = dbStore.blogPosts.indexOf(b);
    if (idx >= 0) dbStore.blogPosts.splice(idx, 1);
  }

  const auditService = new AuditService();
  const blogsService = new BlogsService(auditService);

  // ================= TEST 1: Default Global Educational Blogs Bootstrapping =================
  console.log('Test 1: Verifying Default Educational Blogs Seeded in Database...');
  await blogsService.ensureDefaultBlogs();
  const globalBlogs = dbStore.blogPosts.filter((b) => !b.deletedAt && b.scopeType === 'GLOBAL');
  assert.ok(globalBlogs.length >= 10, `Expected at least 10 default global blogs, found ${globalBlogs.length}`);

  const whatIsAffiliate = globalBlogs.find((b) => b.slug === 'what-is-affiliate-marketing');
  assert.ok(whatIsAffiliate, 'Should find what-is-affiliate-marketing post');
  assert.strictEqual(whatIsAffiliate?.status, 'PUBLISHED');
  assert.strictEqual(whatIsAffiliate?.scopeType, 'GLOBAL');
  assert.ok(whatIsAffiliate?.content, 'Post should have structured content');
  console.log('  ✓ Test 1 passed: 10 default educational blogs are present in DB.');

  // ================= TEST 2: Global vs Organization Scoping & Permissions =================
  console.log('\nTest 2: Verifying Scoping & Permission Boundaries...');

  // Non-superadmin cannot create GLOBAL blog
  await assert.rejects(
    async () => {
      await blogsService.create(
        {
          title: 'Unauthorized Global Blog',
          excerpt: 'This should fail',
          content: 'Test content',
          category: 'affiliate-marketing',
          scopeType: 'GLOBAL',
        },
        { userId: 'regular-user', isSuperAdmin: false },
      );
    },
    /Only platform administrators can create global blogs/,
    'Non-superadmin must be prevented from creating GLOBAL blog',
  );

  // Superadmin CAN create GLOBAL blog
  const adminGlobalBlog = await blogsService.create(
    {
      title: 'Platform Master Guide to Attribution',
      excerpt: 'Authoritative guide from PartnerIQ',
      content: 'Detailed attribution mechanics',
      category: 'attribution-tracking',
      scopeType: 'GLOBAL',
      status: 'PUBLISHED',
    },
    { userId: 'super-admin-user', isSuperAdmin: true },
  );
  assert.strictEqual(adminGlobalBlog.scopeType, 'GLOBAL');
  assert.strictEqual(adminGlobalBlog.slug, 'platform-master-guide-to-attribution');
  console.log('  ✓ Test 2 passed: Global blog permissions verified.');

  // ================= TEST 3: Organization Blog Creation & Auto-slug =================
  console.log('\nTest 3: Verifying Organization Blog Creation & Slug Uniqueness...');
  const orgAId = 'org-acme-corp-123';
  const orgBId = 'org-beta-tech-456';

  // Seed sample organizations in dbStore
  dbStore.organizations.push(
    { id: orgAId, name: 'Acme Corp', slug: 'acme-corp', status: 'ACTIVE', createdBy: 'admin-user' } as any,
    { id: orgBId, name: 'Beta Tech', slug: 'beta-tech', status: 'ACTIVE', createdBy: 'admin-user' } as any,
  );

  const orgABlog1 = await blogsService.create(
    {
      title: 'Acme Partner Program Getting Started',
      excerpt: 'Everything you need to succeed with Acme',
      content: 'Welcome to Acme partner ecosystem',
      category: 'program-guides',
      scopeType: 'ORGANIZATION',
      organizationId: orgAId,
      status: 'DRAFT',
    },
    { userId: 'acme-admin-user', isSuperAdmin: false },
    { scopeType: 'ORGANIZATION', organizationId: orgAId },
  );

  assert.strictEqual(orgABlog1.scopeType, 'ORGANIZATION');
  assert.strictEqual(orgABlog1.organizationId, orgAId);
  assert.strictEqual(orgABlog1.slug, 'acme-partner-program-getting-started');
  assert.strictEqual(orgABlog1.status, 'DRAFT');

  // Duplicate title generates distinct unique slug
  const orgABlogDuplicate = await blogsService.create(
    {
      title: 'Acme Partner Program Getting Started',
      excerpt: 'Duplicate slug test',
      content: 'Content test',
      category: 'program-guides',
      scopeType: 'ORGANIZATION',
      organizationId: orgAId,
    },
    { userId: 'acme-admin-user', isSuperAdmin: false },
    { scopeType: 'ORGANIZATION', organizationId: orgAId },
  );
  assert.strictEqual(orgABlogDuplicate.slug, 'acme-partner-program-getting-started-1');
  console.log('  ✓ Test 3 passed: Organization blog creation and slug uniqueness verified.');

  // ================= TEST 4: Tenant Isolation & IDOR Protection =================
  console.log('\nTest 4: Verifying Tenant Isolation (Cross-Tenant Protection)...');

  // Org B user cannot view Org A blog via organization endpoint
  await assert.rejects(
    async () => {
      await blogsService.findById(orgABlog1.id, orgBId);
    },
    /You do not have access to this organization blog post/,
    'Org B must not access Org A blog',
  );

  // Org B user cannot modify Org A blog
  await assert.rejects(
    async () => {
      await blogsService.update(
        orgABlog1.id,
        { title: 'Malicious Hijack' },
        { userId: 'beta-admin-user', isSuperAdmin: false },
        orgBId,
      );
    },
    /Cannot modify a blog belonging to another organization/,
    'Org B must not update Org A blog',
  );

  // Org B user cannot publish Org A blog
  await assert.rejects(
    async () => {
      await blogsService.publish(orgABlog1.id, { userId: 'beta-admin-user', isSuperAdmin: false }, orgBId);
    },
    /Cannot publish blog belonging to another organization/,
  );

  // Org B user cannot delete Org A blog
  await assert.rejects(
    async () => {
      await blogsService.delete(orgABlog1.id, { userId: 'beta-admin-user', isSuperAdmin: false }, orgBId);
    },
    /Cannot delete blog from another organization/,
  );
  console.log('  ✓ Test 4 passed: Multi-tenant boundary successfully prevented cross-tenant access.');

  // ================= TEST 5: Content Lifecycle (Publish / Unpublish / Duplicate / Soft Delete) =================
  console.log('\nTest 5: Verifying Blog Lifecycle (Publish/Unpublish/Duplicate/Delete)...');

  // Publish Org A blog
  const publishedOrgA = await blogsService.publish(orgABlog1.id, { userId: 'acme-admin-user' }, orgAId);
  assert.strictEqual(publishedOrgA.status, 'PUBLISHED');
  assert.ok(publishedOrgA.publishedAt, 'publishedAt must be set upon publish');

  // Duplicate Org A blog
  const duplicatedBlog = await blogsService.duplicate(orgABlog1.id, { userId: 'acme-admin-user' }, orgAId);
  assert.strictEqual(duplicatedBlog.status, 'DRAFT');
  assert.strictEqual(duplicatedBlog.title, 'Acme Partner Program Getting Started (Copy)');
  assert.ok(duplicatedBlog.slug.includes('-copy'), 'Duplicated slug should contain -copy');

  // Unpublish
  const unpublished = await blogsService.unpublish(orgABlog1.id, { userId: 'acme-admin-user' }, orgAId);
  assert.strictEqual(unpublished.status, 'DRAFT');

  // Re-publish for affiliate resolution tests
  await blogsService.publish(orgABlog1.id, { userId: 'acme-admin-user' }, orgAId);

  // Create & Publish Org B blog
  const orgBBlog = await blogsService.create(
    {
      title: 'Beta Tech Exclusive Developer Guide',
      excerpt: 'Private to Beta Tech partners',
      content: 'Top secret Beta Tech guide',
      category: 'program-guides',
      scopeType: 'ORGANIZATION',
      organizationId: orgBId,
      status: 'PUBLISHED',
    },
    { userId: 'beta-admin-user', isSuperAdmin: false },
    { scopeType: 'ORGANIZATION', organizationId: orgBId },
  );
  await blogsService.publish(orgBBlog.id, { userId: 'beta-admin-user' }, orgBId);
  console.log('  ✓ Test 5 passed: Content lifecycle operations verified.');

  // ================= TEST 6: Affiliate Portal Resolution =================
  console.log('\nTest 6: Verifying Affiliate Portal Visibility Resolution...');

  // Affiliate 1 is associated with Acme Corp (orgAId) ONLY
  const affiliate1UserId = 'affiliate-user-1';
  const affiliate1Email = 'sarah.partner@example.com';
  dbStore.affiliates.push({
    id: 'aff-1',
    userId: affiliate1UserId,
    email: affiliate1Email,
    displayName: 'Sarah Partner',
    country: 'US',
    organizationId: orgAId,
    status: 'ACTIVE',
  } as any);

  // Query blogs for Affiliate 1
  const affiliate1Result = await blogsService.listForAffiliate(affiliate1UserId, affiliate1Email, {});

  // Affiliate 1 must see Global blogs
  assert.ok(
    affiliate1Result.data.some((p: any) => p.slug === 'what-is-affiliate-marketing'),
    'Affiliate 1 must receive global educational blogs',
  );

  // Affiliate 1 must see Acme Corp blog
  assert.ok(
    affiliate1Result.data.some((p: any) => p.id === orgABlog1.id),
    'Affiliate 1 must receive Acme Corp (partnered) blog',
  );

  // Affiliate 1 must NEVER see Beta Tech blog (unpartnered organization)
  assert.ok(
    !affiliate1Result.data.some((p: any) => p.id === orgBBlog.id),
    'Affiliate 1 must NEVER see Beta Tech (unpartnered) blog',
  );

  // Affiliate 1 must NOT see draft blogs
  assert.ok(
    !affiliate1Result.data.some((p: any) => p.status === 'DRAFT'),
    'Affiliate 1 must NEVER see DRAFT blogs',
  );

  // Slug lookup authorization
  const canReadAcmeSlug = await blogsService.findBySlug(
    'acme-partner-program-getting-started',
    { userId: affiliate1UserId, email: affiliate1Email },
  );
  assert.strictEqual(canReadAcmeSlug.id, orgABlog1.id);

  await assert.rejects(
    async () => {
      await blogsService.findBySlug('beta-tech-exclusive-developer-guide', {
        userId: affiliate1UserId,
        email: affiliate1Email,
      });
    },
    /You are not authorized to view this organization article/,
    'Affiliate must be rejected when requesting unpartnered organization article by slug',
  );
  console.log('  ✓ Test 6 passed: Affiliate scoping accurately resolved authorized content only.');

  // ================= TEST 7: Audit Logging =================
  console.log('\nTest 7: Verifying Centralized Audit Logging Records...');
  const blogAuditLogs = dbStore.auditLogs.filter((l) => l.resourceType === 'blog_post');
  assert.ok(blogAuditLogs.length > 0, 'Audit logs must record blog operations');

  const actions = blogAuditLogs.map((l) => l.action);
  assert.ok(actions.includes(AuditAction.BLOG_CREATED), 'Must have BLOG_CREATED audit entry');
  assert.ok(actions.includes(AuditAction.BLOG_PUBLISHED), 'Must have BLOG_PUBLISHED audit entry');
  assert.ok(actions.includes(AuditAction.BLOG_UNPUBLISHED), 'Must have BLOG_UNPUBLISHED audit entry');
  console.log(`  ✓ Test 7 passed: ${blogAuditLogs.length} blog audit events verified.`);

  console.log('\n🎉 ALL 7 BLOG MANAGEMENT TEST SUITES PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

runBlogManagementTests().catch((err) => {
  console.error('❌ Blog management test failure:', err);
  process.exit(1);
});
