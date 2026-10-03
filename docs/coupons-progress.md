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

## Phase 2 — fixtures: done → docs/coupons-phase2-fixtures.md (prefix e2e-cpn-1791051925353, run MUSQ2MAX)

## Phase 3 — scenario baseline (pre-fix), commit c5cf728

Raw proof: docs/coupons-proof/baseline/<letter>.txt, run summaries docs/coupons-proof/baseline/_test-runs.txt.
CHECKPOINT 2 report (written instead of stopping): baseline = FAIL for A (settings fetched twice), B (no use
records), C2 (affiliate filter ignored), D (end day excluded / UTC dates), E (11 code rules), F (no 409, race),
H (edit saved on 400, history rewritten), I (paused/archived/expired coupons accepted at sale), J (by-affiliate
history follows current assignment), K (coupon affiliate never credited), L (no stored discount, 12.5 % impossible),
M (limits never enforced), N, O, P, Q (payout impossible: ledger balance never persisted), R (portal zeros), S (no
rate limit, emails in response), T, U (path echo only), V (VIEWER sees all controls, ANALYST page of 403s),
W (5 input gaps), X (rows left behind), Y (201 while table locked), Z (no BOM, no formula guard, JSON columns),
AA (selector issue), AB (fake zeros, stale filter results), AC (stale token — test bug), AD (no before/after),
AE (backend cannot boot with 200k uses — store.ts), G (generator does not avoid existing codes).
PASS at baseline: E1/E4, J2, S1/S2, T3, W (22 of 30), W-json, W-sql, W-invalid-id.

## Phase 4 — fixes (CHECKPOINT 3 reports, money first)

| # | Sev | Bug (money first) | Commit | Proving scenario |
|---|---|---|---|---|
| 1 | Critical (money) | Coupons ignored at sale time: limits, status, dates never enforced; coupon affiliate never credited; `couponAttributionPriority` never read | BE 52aa339 | I, K, M, N, P |
| 2 | Critical (money) | New affiliate's EARNED balance never persisted (ledger proxy bypass) → payouts see no balance; balances lost on restart | BE 1c47bb3 | Q2 |
| 3 | High (money) | Discount KPIs re-derived from the current discount and treated paid amounts as gross; edits rewrote history | BE 4f96bd9 (+b2bf59f) | B, H3, L |
| 4 | High (money) | 100 %-off / fixed > price orders unrecordable (amount ≥ 1) → uses never counted | BE 52aa339 | L FREE / FIXBIG |
| 5 | High | 4xx left coupons/edits behind (create with bad affiliate, edit end<start) | BE 4f96bd9 | H2, W16/17, X1/X2 |
| 6 | High | API returned 201/200 while MySQL write was blocked; memory-only rows | BE 4f96bd9 | Y |
| 7 | High | Code rules: too long (memory-only), %/quotes/spaces/emoji/Cyrillic accepted, case kept, duplicate 400 not 409, race | BE 4f96bd9 | E, F |
| 8 | Medium | Org timezone ignored; UI sent UTC midnight (end day excluded) | BE 4f96bd9, FE | D, H1, P |
| 9 | Medium | by-affiliate history followed current assignment | BE 4f96bd9 | J1 |
| 10 | Medium | Validate endpoint unthrottled, returned affiliate emails | BE 4f96bd9 | S |
| 11 | Medium | Archived coupons could be reactivated/edited; archive needed only coupons.edit | BE 4f96bd9 | I3, V |
| 12 | Medium | Audit rows without before/after | BE 4f96bd9 | AD |
| 13 | Medium | Migration down() partially reverted when refusing (found by round-trip) | BE b2bf59f | migration-roundtrip.txt |
| 14 | Medium | Concurrent coupon uses deadlocked → 503 | BE 52aa339 | N |
| 15 | Medium | Portal showed Uses/Sales/Earned = 0, `$`, "Active" for expired | AP | R |
| 16+ | UI | FE: permission gating, error state instead of zeros, stale-response guard, affiliate filter, settings dedupe, export hardening, dialogs reset, date-only, per-customer field, generator | FE 7cbdd99, 6813153, 157ad54, 8cb16bb | A, AA, AB, C, D, G, V, Z |
| 17 | High | On/off switch memory-first (200 while MySQL blocked) | BE 015730a | Y2 |
| 18 | Low | Assignment email failure swallowed | BE 82c3e9c | review |
| 19 | Critical (audit-introduced, test DB) | discountValue type change wiped values via schema sync | BE 98fc200 | incident-discountValue-sync.txt |

Full list with cause/impact: docs/coupons-audit.md §4.

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

## Phase 5 — final (2026-10-03)

- Final coupon suite (A–AE incl. AE 50k/55k, S4 billing boundary): **126 passed, 0 failed** (docs/coupons-audit.md §10).
- Found during final runs: admin auth refresh race (D22, reported, not fixed), settings memory-first (fixed 015730a),
  settings requested twice (fixed FE 8cb16bb), swallowed assignment email error (fixed 82c3e9c).
- Report: docs/coupons-audit.md. Decisions: docs/decisions.md D1–D25.
