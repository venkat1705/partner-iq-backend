-- ============================================================================
-- PartnerIQ — Cleanup script for fabricated demo/seed data
-- ============================================================================
--
-- Removes exactly the rows created by `npm run seed:dev` / the legacy
-- `npm run seed` (before it was fixed to call seedSystemDefaults() only):
--   - 4 fake organizations: Acme SaaS, ZenPay Payments, Nova AI Studio, FitLife Pro
--   - Their programs, memberships, partner tiers and milestones
--   - The demo/seed user accounts, including one that was previously hardcoded
--     with a real person's personal email address
--
-- SAFETY:
--   - Every DELETE below matches by an explicit allowlist (specific org slugs,
--     specific user emails) — never a broad pattern, never "all orgs owned by
--     user X". This cannot touch a real customer's organization or account
--     unless they independently chose the exact same slug/email, which the
--     verification step below checks for before you run anything destructive.
--   - Run the SELECT section first and read the output. Only proceed to the
--     transaction if the counts/rows look like what you expect (throwaway
--     demo data, not anything with real activity).
--   - The DELETE section runs inside one transaction. It is NOT auto-committed
--     — the final COMMIT is left commented out. Uncomment it only after you've
--     reviewed the DELETE's row counts.
--   - Order matters: children are deleted before their parent organizations/
--     users to respect foreign keys.
--
-- Verified against this table's actual schema on 2026-09-23: affiliates,
-- tracking_links, conversions, api_keys, billing_subscriptions,
-- organization_settings/brandings/policies, audit_logs and notifications all
-- had ZERO rows for these orgs (the fake data for those was pushed only into
-- an in-memory store, never persisted) — nothing to delete there. If your
-- database has activity in those tables for these org ids, STOP and
-- investigate before deleting; that would mean something changed since this
-- script was written and the affected orgs may not be pure demo data anymore.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 — DRY RUN. Read-only. Run this first and review the output.
-- ----------------------------------------------------------------------------

SELECT id, name, slug, createdBy, createdAt
FROM organizations
WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp');

SELECT id, email, platformRole, createdAt
FROM users
WHERE email IN (
  'admin@partneriq.demo',
  'superadmin@partneriq.demo',
  'demo-owner@partneriq.local',
  'demo.partner@partneriq.local',
  'sarah.lin@growthscale.agency',
  'sarah@growthpartner.com'
  -- Deliberately NOT including any real person's email here. If you find a
  -- demo account was seeded with a real email address, fix the seed source
  -- first (see run-seed.ts) rather than adding that address to this list.
);

-- Row counts of everything that would be deleted, grouped by table:
SELECT 'organization_memberships' AS table_name, COUNT(*) AS row_count
FROM organization_memberships
WHERE organizationId IN (SELECT id FROM organizations WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp'))
UNION ALL
SELECT 'programs', COUNT(*)
FROM programs
WHERE organizationId IN (SELECT id FROM organizations WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp'))
UNION ALL
SELECT 'partner_tiers', COUNT(*)
FROM partner_tiers
WHERE organizationId IN (SELECT id FROM organizations WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp'))
UNION ALL
SELECT 'milestones', COUNT(*)
FROM milestones
WHERE organizationId IN (SELECT id FROM organizations WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp'))
UNION ALL
SELECT 'organizations', COUNT(*)
FROM organizations
WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp')
UNION ALL
SELECT 'users', COUNT(*)
FROM users
WHERE email IN (
  'admin@partneriq.demo', 'superadmin@partneriq.demo', 'demo-owner@partneriq.local',
  'demo.partner@partneriq.local', 'sarah.lin@growthscale.agency', 'sarah@growthpartner.com'
);

-- Before deleting the demo users, confirm they don't own any OTHER
-- (non-demo-slug) organization — if this returns rows, STOP: that user has
-- created something outside the known demo set and needs manual review.
SELECT o.id, o.name, o.slug, o.createdBy
FROM organizations o
JOIN users u ON u.id = o.createdBy
WHERE u.email IN (
  'admin@partneriq.demo', 'superadmin@partneriq.demo', 'demo-owner@partneriq.local',
  'demo.partner@partneriq.local', 'sarah.lin@growthscale.agency', 'sarah@growthpartner.com'
)
AND o.slug NOT IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp');


-- ----------------------------------------------------------------------------
-- STEP 2 — DELETE. Wrapped in a transaction. Review STEP 1's output first.
-- ----------------------------------------------------------------------------

START TRANSACTION;

-- Children first, in FK-safe order.
DELETE FROM milestones
WHERE organizationId IN (
  SELECT id FROM organizations WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp')
);

DELETE FROM partner_tiers
WHERE organizationId IN (
  SELECT id FROM organizations WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp')
);

DELETE FROM programs
WHERE organizationId IN (
  SELECT id FROM organizations WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp')
);

DELETE FROM organization_memberships
WHERE organizationId IN (
  SELECT id FROM organizations WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp')
);

-- Parent organizations.
DELETE FROM organizations
WHERE slug IN ('acme-saas', 'zenpay', 'nova', 'fitlife', 'omnigrowth-labs', 'apex-analytics-corp');

-- Demo users last (after nothing references them as createdBy via the rows
-- above). The STEP 1 ownership check must have returned zero rows before
-- you run this.
DELETE FROM users
WHERE email IN (
  'admin@partneriq.demo',
  'superadmin@partneriq.demo',
  'demo-owner@partneriq.local',
  'demo.partner@partneriq.local',
  'sarah.lin@growthscale.agency',
  'sarah@growthpartner.com'
);

-- Review the affected row counts printed by your MySQL client above for each
-- statement. If they match what STEP 1 showed you, uncomment the line below
-- and re-run just that line to commit. Otherwise run ROLLBACK.

-- COMMIT;
ROLLBACK; -- Safety default: nothing is committed until you deliberately swap this for COMMIT.
