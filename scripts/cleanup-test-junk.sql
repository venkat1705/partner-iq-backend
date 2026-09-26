-- ==============================================================================
-- DRY RUN: Identification & Safe Cleanup Script for Legacy Test Junk in Dev DB
-- Database: partneriq_dev_new3
--
-- IMPORTANT SAFETY NOTE:
-- All DELETE statements are intentionally COMMENTED OUT.
-- Run SELECT queries first to inspect and confirm all matching test rows.
-- Cleanup must be executed in foreign-key safe order (child rows before parent rows).
-- ==============================================================================

USE `partneriq_dev_new3`;

-- ------------------------------------------------------------------------------
-- PART 1: EXACT TEST PREFIXES (SAFE TO DELETE AFTER VERIFICATION)
-- ------------------------------------------------------------------------------

-- 1. TRACKING LINKS with exact test patterns
-- Pattern: shortCode like 'TEST%' or specific e2e codes ('smoke-e2e-1', 'invariant-1', 'default-link-%')
SELECT 'TRACKING LINKS - COUNT' AS check_name, COUNT(*) AS match_count
FROM `tracking_links`
WHERE `shortCode` REGEXP '^TEST[0-9]{4}$'
   OR `shortCode` IN ('smoke-e2e-1', 'invariant-1')
   OR `shortCode` LIKE 'default-link-%';

SELECT `id`, `shortCode`, `organizationId`, `affiliateId`, `createdAt`
FROM `tracking_links`
WHERE `shortCode` REGEXP '^TEST[0-9]{4}$'
   OR `shortCode` IN ('smoke-e2e-1', 'invariant-1')
   OR `shortCode` LIKE 'default-link-%';

-- -- SAFE DELETE:
-- DELETE FROM `tracking_links`
-- WHERE `shortCode` REGEXP '^TEST[0-9]{4}$'
--    OR `shortCode` IN ('smoke-e2e-1', 'invariant-1')
--    OR `shortCode` LIKE 'default-link-%';


-- 2. AFFILIATES with test email domains or test prefixes
-- Pattern: emails ending with @partneriq.test or starting with aff-demo-
SELECT 'AFFILIATES - COUNT' AS check_name, COUNT(*) AS match_count
FROM `affiliates`
WHERE `email` LIKE '%@partneriq.test'
   OR `email` LIKE 'aff-demo-%';

SELECT `id`, `email`, `displayName`, `organizationId`, `createdAt`
FROM `affiliates`
WHERE `email` LIKE '%@partneriq.test'
   OR `email` LIKE 'aff-demo-%';

-- -- SAFE DELETE:
-- DELETE FROM `affiliates`
-- WHERE `email` LIKE '%@partneriq.test'
--    OR `email` LIKE 'aff-demo-%';


-- 3. PROGRAMS associated with test orgs or test slugs
-- Pattern: slug matching test-org-% or prog-%
SELECT 'PROGRAMS - COUNT' AS check_name, COUNT(*) AS match_count
FROM `programs`
WHERE `slug` LIKE 'test-org-%'
   OR `slug` LIKE 'prog-%';

SELECT `id`, `name`, `slug`, `organizationId`, `createdAt`
FROM `programs`
WHERE `slug` LIKE 'test-org-%'
   OR `slug` LIKE 'prog-%';

-- -- SAFE DELETE:
-- DELETE FROM `programs`
-- WHERE `slug` LIKE 'test-org-%'
--    OR `slug` LIKE 'prog-%';


-- 4. ORGANIZATION MEMBERSHIPS for test orgs or test users
SELECT 'MEMBERSHIPS - COUNT' AS check_name, COUNT(*) AS match_count
FROM `organization_memberships`
WHERE `organizationId` IN (
  SELECT `id` FROM `organizations`
  WHERE `slug` LIKE 'test-org-%'
     OR `slug` LIKE 'org-acme-corp-%'
     OR `slug` LIKE 'org-onboarding-%'
     OR `slug` LIKE 'dup-slug-test-%'
     OR `slug` LIKE 'org-e2e-%'
     OR `slug` LIKE 'org-audit-%'
     OR `slug` LIKE 'org-inv-%'
     OR `slug` = 'tenant-b-org'
) OR `userId` IN (
  SELECT `id` FROM `users`
  WHERE `email` LIKE '%@partneriq.test'
     OR `email` LIKE 'newuser_%@acme.com'
     OR `email` LIKE 'password_user_%@acme.com'
     OR `email` LIKE 'invitee_%@acme.com'
     OR `email` LIKE 'target_invite_%@acme.com'
     OR `email` LIKE 'replay_%@acme.com'
     OR `email` LIKE 'suspended_%@acme.com'
     OR `email` = 'victim_customer@acme.com'
     OR `email` = 'hacker@partneriq.demo'
     OR `firstName` = 'admin-user'
);

SELECT `id`, `organizationId`, `userId`, `role`, `createdAt`
FROM `organization_memberships`
WHERE `organizationId` IN (
  SELECT `id` FROM `organizations`
  WHERE `slug` LIKE 'test-org-%'
     OR `slug` LIKE 'org-acme-corp-%'
     OR `slug` LIKE 'org-onboarding-%'
     OR `slug` LIKE 'dup-slug-test-%'
     OR `slug` LIKE 'org-e2e-%'
     OR `slug` LIKE 'org-audit-%'
     OR `slug` LIKE 'org-inv-%'
     OR `slug` = 'tenant-b-org'
) OR `userId` IN (
  SELECT `id` FROM `users`
  WHERE `email` LIKE '%@partneriq.test'
     OR `email` LIKE 'newuser_%@acme.com'
     OR `email` LIKE 'password_user_%@acme.com'
     OR `email` LIKE 'invitee_%@acme.com'
     OR `email` LIKE 'target_invite_%@acme.com'
     OR `email` LIKE 'replay_%@acme.com'
     OR `email` LIKE 'suspended_%@acme.com'
     OR `email` = 'victim_customer@acme.com'
     OR `email` = 'hacker@partneriq.demo'
     OR `firstName` = 'admin-user'
);

-- -- SAFE DELETE:
-- DELETE FROM `organization_memberships`
-- WHERE `organizationId` IN (
--   SELECT `id` FROM `organizations`
--   WHERE `slug` LIKE 'test-org-%'
--      OR `slug` LIKE 'org-acme-corp-%'
--      OR `slug` LIKE 'org-onboarding-%'
--      OR `slug` LIKE 'dup-slug-test-%'
--      OR `slug` LIKE 'org-e2e-%'
--      OR `slug` LIKE 'org-audit-%'
--      OR `slug` LIKE 'org-inv-%'
--      OR `slug` = 'tenant-b-org'
-- ) OR `userId` IN (
--   SELECT `id` FROM `users`
--   WHERE `email` LIKE '%@partneriq.test'
--      OR `email` LIKE 'newuser_%@acme.com'
--      OR `email` LIKE 'password_user_%@acme.com'
--      OR `email` LIKE 'invitee_%@acme.com'
--      OR `email` LIKE 'target_invite_%@acme.com'
--      OR `email` LIKE 'replay_%@acme.com'
--      OR `email` LIKE 'suspended_%@acme.com'
--      OR `email` = 'victim_customer@acme.com'
--      OR `email` = 'hacker@partneriq.demo'
--      OR `firstName` = 'admin-user'
-- );


-- 5. ORGANIZATIONS with test slugs / names
SELECT 'ORGANIZATIONS - COUNT' AS check_name, COUNT(*) AS match_count
FROM `organizations`
WHERE `slug` LIKE 'test-org-%'
   OR `slug` LIKE 'org-acme-corp-%'
   OR `slug` LIKE 'org-onboarding-%'
   OR `slug` LIKE 'dup-slug-test-%'
   OR `slug` LIKE 'org-e2e-%'
   OR `slug` LIKE 'org-audit-%'
   OR `slug` LIKE 'org-inv-%'
   OR `slug` = 'tenant-b-org'
   OR `name` = 'Tenant B Org';

SELECT `id`, `name`, `slug`, `status`, `createdAt`
FROM `organizations`
WHERE `slug` LIKE 'test-org-%'
   OR `slug` LIKE 'org-acme-corp-%'
   OR `slug` LIKE 'org-onboarding-%'
   OR `slug` LIKE 'dup-slug-test-%'
   OR `slug` LIKE 'org-e2e-%'
   OR `slug` LIKE 'org-audit-%'
   OR `slug` LIKE 'org-inv-%'
   OR `slug` = 'tenant-b-org'
   OR `name` = 'Tenant B Org';

-- -- SAFE DELETE:
-- DELETE FROM `organizations`
-- WHERE `slug` LIKE 'test-org-%'
--    OR `slug` LIKE 'org-acme-corp-%'
--    OR `slug` LIKE 'org-onboarding-%'
--    OR `slug` LIKE 'dup-slug-test-%'
--    OR `slug` LIKE 'org-e2e-%'
--    OR `slug` LIKE 'org-audit-%'
--    OR `slug` LIKE 'org-inv-%'
--    OR `slug` = 'tenant-b-org'
--    OR `name` = 'Tenant B Org';


-- 6. USERS with test email addresses or test handles
SELECT 'USERS - COUNT' AS check_name, COUNT(*) AS match_count
FROM `users`
WHERE `email` LIKE '%@partneriq.test'
   OR `email` LIKE 'newuser_%@acme.com'
   OR `email` LIKE 'password_user_%@acme.com'
   OR `email` LIKE 'invitee_%@acme.com'
   OR `email` LIKE 'target_invite_%@acme.com'
   OR `email` LIKE 'replay_%@acme.com'
   OR `email` LIKE 'suspended_%@acme.com'
   OR `email` = 'victim_customer@acme.com'
   OR `email` = 'hacker@partneriq.demo'
   OR `firstName` = 'admin-user';

SELECT `id`, `email`, `firstName`, `lastName`, `platformRole`, `createdAt`
FROM `users`
WHERE `email` LIKE '%@partneriq.test'
   OR `email` LIKE 'newuser_%@acme.com'
   OR `email` LIKE 'password_user_%@acme.com'
   OR `email` LIKE 'invitee_%@acme.com'
   OR `email` LIKE 'target_invite_%@acme.com'
   OR `email` LIKE 'replay_%@acme.com'
   OR `email` LIKE 'suspended_%@acme.com'
   OR `email` = 'victim_customer@acme.com'
   OR `email` = 'hacker@partneriq.demo'
   OR `firstName` = 'admin-user';

-- -- SAFE DELETE:
-- DELETE FROM `users`
-- WHERE `email` LIKE '%@partneriq.test'
--    OR `email` LIKE 'newuser_%@acme.com'
--    OR `email` LIKE 'password_user_%@acme.com'
--    OR `email` LIKE 'invitee_%@acme.com'
--    OR `email` LIKE 'target_invite_%@acme.com'
--    OR `email` LIKE 'replay_%@acme.com'
--    OR `email` LIKE 'suspended_%@acme.com'
--    OR `email` = 'victim_customer@acme.com'
--    OR `email` = 'hacker@partneriq.demo'
--    OR `firstName` = 'admin-user';


-- ------------------------------------------------------------------------------
-- PART 2: BROAD PATTERNS (NEEDS MANUAL REVIEW - NO DELETE STATEMENTS PROVIDED)
-- ------------------------------------------------------------------------------
-- The following queries return rows that might be legitimate local developer test data
-- or demo data. Manually review these before deciding whether to purge them.

-- A. Generic example.com or acme.com emails not matched by specific test patterns:
SELECT 'REVIEW: Generic example.com/acme.com users' AS review_name, id, email, platformRole, createdAt
FROM `users`
WHERE (`email` LIKE '%@example.com' OR `email` LIKE '%@acme.com')
  AND `email` NOT LIKE 'newuser_%'
  AND `email` NOT LIKE 'password_user_%'
  AND `email` NOT LIKE 'invitee_%'
  AND `email` NOT LIKE 'target_invite_%'
  AND `email` NOT LIKE 'replay_%'
  AND `email` NOT LIKE 'suspended_%'
  AND `email` != 'victim_customer@acme.com';

-- B. Affiliates with generic names (e.g., sarah.partner@example.com, partner1@example.com):
SELECT 'REVIEW: Generic affiliate accounts' AS review_name, id, email, displayName, createdAt
FROM `affiliates`
WHERE `email` IN ('sarah.partner@example.com', 'partner1@example.com')
   OR `email` LIKE '%@example.com';

-- C. Programs containing 'Partner Program' without test prefixes:
SELECT 'REVIEW: Programs with generic Partner Program name' AS review_name, id, name, slug, organizationId
FROM `programs`
WHERE `name` LIKE '%Partner Program%'
  AND `slug` NOT LIKE 'test-org-%'
  AND `slug` NOT LIKE 'prog-%';

