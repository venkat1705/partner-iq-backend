import assert from 'assert';
import { dbStore } from '../database/store';
import { SystemTemplateKey, SYSTEM_SECURITY_TEMPLATE_KEYS, SYSTEM_TEMPLATE_CATALOG } from '../modules/email-design/constants/email-template-keys';
import { TemplateResolverService } from '../modules/email-design/services/template-resolver.service';
import { TemplateRendererService } from '../modules/email-design/services/template-renderer.service';
import { EmailSuppressionService } from '../modules/email-design/services/email-suppression.service';
import { EmailQueueProducer } from '../modules/email-design/queue/email-queue.producer';
import { EmailQueueWorker } from '../modules/email-design/queue/email-queue.worker';
import { DomainEventEmailListener } from '../modules/email-design/listeners/domain-event-email.listener';
import { DevelopmentEmailProvider } from '../modules/email-design/providers/development-email.provider';
import { EmailProviderFactory } from '../modules/email-design/providers/email-provider.factory';
import { BrevoEmailProvider } from '../modules/email-design/providers/brevo-email.provider';

async function runEmailInfrastructureTests() {
  console.log('🚀 Running Centralized Email Infrastructure Test Suite...\n');

  // Initialize DB Store
  await dbStore.initialize();

  const resolver = new TemplateResolverService();
  const renderer = new TemplateRendererService();
  const suppressionSvc = new EmailSuppressionService();
  const producer = new EmailQueueProducer();
  const devProvider = new DevelopmentEmailProvider();
  const brevoProvider = new BrevoEmailProvider();
  const providerFactory = new EmailProviderFactory(brevoProvider, devProvider);
  const worker = new EmailQueueWorker(resolver, renderer, suppressionSvc, providerFactory);
  const eventListener = new DomainEventEmailListener(producer);

  // TEST 1: Catalog & Security Keys Metadata
  console.log('Test 1: Verifying System Template Catalog & Security Protection...');
  assert.strictEqual(SYSTEM_SECURITY_TEMPLATE_KEYS.length, 8, 'Must have 8 protected system security keys');
  assert.ok(SYSTEM_SECURITY_TEMPLATE_KEYS.includes(SystemTemplateKey.SECURITY_PASSWORD_RESET));
  assert.ok(SYSTEM_SECURITY_TEMPLATE_KEYS.includes(SystemTemplateKey.SECURITY_TWO_FACTOR_ENABLED));
  const catalogItem = SYSTEM_TEMPLATE_CATALOG[SystemTemplateKey.AFFILIATE_COMMISSION_APPROVED];
  assert.strictEqual(catalogItem.category, 'COMMISSION');
  assert.strictEqual(catalogItem.ownership, 'ORGANIZATION');
  console.log('  ✓ Test 1 passed!');

  // TEST 2: Template Resolver Precedence
  console.log('\nTest 2: Verifying Multi-Tenant Template Resolution Precedence...');
  // Security template -> SYSTEM_SECURITY
  const resSecurity = await resolver.resolveTemplate(SystemTemplateKey.SECURITY_PASSWORD_RESET, 'org-acme-123');
  assert.strictEqual(resSecurity.source, 'SYSTEM_SECURITY', 'Security templates must resolve as SYSTEM_SECURITY');

  // Org Override
  dbStore.emailTemplateOverrides.push({
    id: 'ov-1',
    organizationId: 'org-acme-123',
    templateKey: SystemTemplateKey.AFFILIATE_WELCOME,
    status: 'PUBLISHED',
    customSubject: 'Welcome to ACME Partner Network!',
    customBody: '<h1>Custom ACME Welcome {{affiliate.firstName}}</h1>',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  const resOverride = await resolver.resolveTemplate(SystemTemplateKey.AFFILIATE_WELCOME, 'org-acme-123');
  assert.strictEqual(resOverride.source, 'ORGANIZATION_OVERRIDE');
  assert.strictEqual(resOverride.subject, 'Welcome to ACME Partner Network!');

  const resFallback = await resolver.resolveTemplate(SystemTemplateKey.AFFILIATE_WELCOME, 'org-zenco-456');
  assert.notStrictEqual(resFallback.source, 'ORGANIZATION_OVERRIDE', 'Other orgs must not receive ACME override');
  console.log('  ✓ Test 2 passed!');

  // TEST 3: Renderer HTML Escaping & Payload Validation
  console.log('\nTest 3: Verifying HTML XSS Escaping & Variable Payload Validation...');
  const escaped = renderer.escapeHtml('<script>alert("xss")</script>');
  assert.strictEqual(escaped, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;', 'Must escape dangerous HTML script tags');

  // Payload Validation Fail
  assert.throws(() => {
    renderer.validatePayload(SystemTemplateKey.SECURITY_PASSWORD_RESET, { user: {} });
  }, /Missing required variables/, 'Must throw validation error when required links.resetPasswordUrl is missing');

  // Payload Validation Pass & Render XSS Escaping Test
  const renderResult = renderer.render({
    template: {
      templateKey: SystemTemplateKey.SECURITY_EMAIL_VERIFICATION,
      source: 'SYSTEM_SECURITY',
      subject: 'Verify your email {{user.firstName}}',
      bodyTemplate: '<p>Hi {{user.firstName}}, welcome to PartnerIQ!</p>',
    },
    payload: {
      user: { firstName: '<Jane>' },
      links: { verificationUrl: 'https://partneriq.in/verify' },
    },
    recipientEmail: 'jane@example.com',
  });
  assert.ok(renderResult.html.includes('&lt;Jane&gt;'), 'Rendered HTML body must contain escaped user input');
  assert.ok(renderResult.subject.includes('&lt;Jane&gt;'), 'Subject line must contain escaped user input');

  // Custom Payload HTML & Subject Override Test
  const customPayloadRender = renderer.render({
    template: {
      templateKey: SystemTemplateKey.AFFILIATE_WELCOME,
      source: 'ORGANIZATION_OVERRIDE',
      subject: 'Fallback Subject',
      bodyTemplate: '<p>Fallback Body</p>',
    },
    payload: {
      subject: 'Custom Subject for {{partnerName}}',
      htmlContent: '<h1>Custom Payload HTML for {{partnerName}} at {{organizationName}}</h1>',
      partnerName: 'Sarah Jenkins',
      organizationName: 'ACME Corp',
      affiliate: { firstName: 'Sarah' },
      links: { dashboardUrl: 'https://acme.partneriq.in' },
    },
    recipientEmail: 'sarah@example.com',
  });
  assert.strictEqual(customPayloadRender.subject, 'Custom Subject for Sarah Jenkins');
  assert.ok(customPayloadRender.html.includes('Custom Payload HTML for Sarah Jenkins at ACME Corp'), 'Must render custom payload HTML');
  console.log('  ✓ Test 3 passed!');

  // TEST 4: Email Suppression Management
  console.log('\nTest 4: Verifying Email Suppression Management...');
  await suppressionSvc.addSuppression({
    email: 'bounced@example.com',
    reason: 'HARD_BOUNCE',
    organizationId: 'org-acme-123',
  });

  const isSuppressedAcme = await suppressionSvc.isSuppressed('bounced@example.com', 'org-acme-123');
  assert.strictEqual(isSuppressedAcme, true, 'Address must be suppressed for ACME');

  const isSuppressedZenco = await suppressionSvc.isSuppressed('bounced@example.com', 'org-zenco-456');
  assert.strictEqual(isSuppressedZenco, false, 'Suppression scoping must respect organizationId when set');

  await suppressionSvc.removeSuppression('bounced@example.com', 'org-acme-123');
  const isRemoved = await suppressionSvc.isSuppressed('bounced@example.com', 'org-acme-123');
  assert.strictEqual(isRemoved, false, 'Removed address must no longer be suppressed');
  console.log('  ✓ Test 4 passed!');

  // TEST 5: Queue Producer & Idempotency
  console.log('\nTest 5: Verifying Email Queue Producer & Idempotency Key Enforcement...');
  const uniqueEventId = `evt-comm-${Date.now()}`;
  const job1 = await producer.enqueue({
    templateKey: SystemTemplateKey.AFFILIATE_COMMISSION_APPROVED,
    recipientEmail: 'affiliate@partner.com',
    payload: {
      affiliate: { firstName: 'Alex' },
      affiliateName: 'Alex',
      organization: { name: 'ACME' },
      commission: { amountFormatted: '$250.00' },
    },
    eventId: uniqueEventId,
    organizationId: 'org-acme-123',
  });
  assert.strictEqual(job1.isDuplicate, false);

  const job2 = await producer.enqueue({
    templateKey: SystemTemplateKey.AFFILIATE_COMMISSION_APPROVED,
    recipientEmail: 'affiliate@partner.com',
    payload: {
      affiliate: { firstName: 'Alex' },
      affiliateName: 'Alex',
      organization: { name: 'ACME' },
      commission: { amountFormatted: '$250.00' },
    },
    eventId: uniqueEventId,
    organizationId: 'org-acme-123',
  });
  assert.strictEqual(job2.isDuplicate, true, 'Duplicate eventId + recipient must be suppressed');
  console.log('  ✓ Test 5 passed!');

  // TEST 6: Queue Worker Execution & Delivery Log Snapshotting
  console.log('\nTest 6: Verifying Queue Worker Execution & Delivery Log Snapshotting...');
  const processedLog = await worker.processJob(job1.jobId);
  assert.strictEqual(processedLog.status, 'SENT', 'Worker must execute job and set status SENT');
  assert.ok(processedLog.snapshotHtml, 'Worker must save immutable rendered HTML snapshot');
  assert.ok(processedLog.snapshotHtml.includes('Alex'), 'Rendered HTML snapshot must contain interpolated affiliate name');
  assert.strictEqual(processedLog.recipientEmailMasked, 'a*******e@partner.com', 'Recipient email must be masked for privacy in logs');
  console.log('  ✓ Test 6 passed!');

  // TEST 7: Domain Event Listener Integration
  console.log('\nTest 7: Verifying Domain Event Listener Integration...');
  const uniquePayoutEventId = `evt-payout-${Date.now()}`;
  const eventRes = await eventListener.handleDomainEvent({
    eventId: uniquePayoutEventId,
    eventType: 'payout.completed',
    organizationId: 'org-acme-123',
    recipientEmail: 'payout-test@partner.com',
    data: {
      affiliate: { firstName: 'Maria' },
      organization: { name: 'ACME' },
      payout: { amountFormatted: '$1,500.00', reference: 'REF-BANK-777' },
    },
  });

  assert.ok(eventRes);
  assert.strictEqual(eventRes.isDuplicate, false);
  const pendingCount = await worker.processAllPending();
  assert.ok(pendingCount >= 1, 'Worker must process enqueued domain event jobs');
  console.log('  ✓ Test 7 passed!');

  console.log('\n✅ ALL CENTRALIZED EMAIL INFRASTRUCTURE TESTS PASSED PERFECTLY!');
}

runEmailInfrastructureTests().catch((err) => {
  console.error('❌ Email Infrastructure Test Suite Failed:', err);
  process.exit(1);
});
