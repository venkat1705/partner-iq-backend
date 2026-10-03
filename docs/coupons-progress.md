# Coupons audit — progress log

Branch: `audit/coupons` (backend, frontend, affiliate-portal).
Re-read this file and the task prompt after any context compaction.

## Phase 0 — environment (done, awaiting Checkpoint 0 reply)

- MySQL 8.0.46 (apt `mysql-server`, Docker daemon not running in container), DB `partneriq_coupons_audit`, user `piq`@localhost.
- Fresh-DB migrations are NOT self-sufficient: `migration:run` failed at
  `AffiliateInvitationLifecycle2026091700000` (`affiliate_invitations` doesn't exist) because no earlier
  migration creates it; the schema is actually built by `synchronize: true` in `src/database/data-source.ts`.
  Worked around: started the app once (synchronize), then `migration:run` applied the remaining 9 (18 total).
- Backend `npm ci` fails (lockfile missing `@emnapi/runtime@1.11.3`); `xlsx` tarball host `cdn.sheetjs.com` is
  blocked by this environment's network policy. Installed with `xlsx@0.18.5` from npm temporarily, then restored
  package.json/package-lock.json (not committed). xlsx is only used by `affiliates.service.ts`.
- Backend run with `npm run build && npm start` (compiled). `tsx src/main.ts` breaks Nest DI (no decorator
  metadata) — not used.
- Playwright 1.56.1 in `e2e/package.json` (separate so the backend lockfile is untouched), Chromium 141 from /opt/pw-browsers.
- Note: prompt says NestJS 10; package.json has @nestjs/* ^11.1.28.

| Service | URL |
|---|---|
| Backend API | http://localhost:5000/api/v1 (Swagger http://localhost:5000/api/docs) |
| Admin frontend | http://localhost:3001 (Vite proxies /api → :5000) |
| Affiliate portal | http://localhost:3005 |

## Phase 1 — inventory: done → docs/coupons-inventory.md (Checkpoint 1 report = that file; continuing per standing instructions)

## Scenarios

(none run yet)

## User decisions (2026-10-03, reply to Checkpoint 0) — MUST survive compaction

1. **Affiliate portal is IN scope** (repo `partner-iq-affiliate-portal`, branch `audit/coupons`, never main).
   - Coupon screens + coupon API calls only; no refactors/fixes outside coupons.
   - Backend↔portal API is a contract: any change to route/request/response shape the portal uses must be
     backward compatible (or flagged). List every field the portal reads from coupon endpoints.
   - Security: affiliate sees only own assigned coupons. Test via API with AFFILIATE_1/AFFILIATE_2 tokens incl.
     tampered IDs/codes; no other affiliates' data, internal discount settings, or org-only fields.
2. **Scope = organization coupons ONLY** (`organization_coupons`, `/organizations/:id/coupons`).
   Billing coupons (`billing_coupons*`) out of scope — do NOT change billing coupon/SaaS billing code.
   But report the boundary: shared tables/services/validation/code-check endpoints? Can an org coupon code be
   applied to SaaS billing checkout, or a billing coupon be used as an affiliate coupon? Test both directions,
   paste results. List shared code paths for the billing audit. If an org-coupon fix touches shared code → (was
   "ask me"; superseded by standing instruction: decide, record in docs/decisions.md).

## Standing instructions (2026-10-03) — MUST survive compaction

- Do NOT ask / do NOT stop at checkpoints: write a progress report into docs/ and continue.
- Decide as org admin + affiliate; order: existing code/docs/UI promise → industry standard (Impact,
  PartnerStack, Refersion, Rewardful, Shopify) → safest for money/data → easiest to change later.
- Record every decision in docs/decisions.md (question, option, why, commit).
- Default coupon rules (unless code documents otherwise): codes trimmed, case-insensitive, stored UPPERCASE,
  unique per org via DB unique (organizationId, normalized code) in reversible migration; reject non-ASCII
  letters; generator avoids ambiguous chars; coupon's affiliate wins attribution (per-org setting, this default);
  commission base = amount paid after discount, excl. tax/shipping; use counted when sale recorded, refunds don't
  return the use, limits enforced atomically in DB; per-customer = customer ID else normalized email; dates in
  org timezone, end valid through 23:59:59 that day; delete used coupon = archive (soft), code not reusable in
  org; reassignment: past sales stay with old affiliate; refund after paid = negative balance offset against
  future commissions, shown to admins; code-check endpoint: same response for missing/expired/inactive,
  rate-limited, never reveal affiliate or internal discount settings.
- Hard limits: never commit/push main, never force-push; never delete/modify existing real data (report
  leftovers); never commit secrets; never change billing coupon/SaaS billing code; never weaken/skip tests;
  never swallow errors; never edit src/database/store.ts; migrations reversible + lossless.
- Blocked → mark BLOCKED with exact reason, work around, continue.
- Finish: push audit branch in every changed repo; final summary with done/decisions/bugs+commits/BLOCKED/
  review-first, money items at top.
