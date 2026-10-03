# Coupons inventory (Phase 1)

Scope: **organization product coupons** only (`organization_coupons*` tables, `/api/v1/organizations/:organizationId/coupons/*`,
`/api/v1/affiliate/me/assigned-coupons`). SaaS billing coupons (`billing_coupons*`) are out of scope except for the boundary
section (§7). Every item is linked to the scenario letters (A–AF) of the audit prompt that prove or disprove it.

Code read at backend `audit/coupons` = `1d2ec48` + audit commits, frontend `audit/coupons` = its `main` head, portal
`audit/coupons` = its `main` head.

---------------------------------------------------------------------------------------------------------------------
## 1. UI inventory

### 1.1 Admin app (partner-iq-frontend) — page `coupons` (`src/components/pages/coupons-view.tsx`)

**Who sees the page/nav item** — `app-layout.tsx:362` shows the nav item when
`canAccessPage(role,'coupons',perms)` (`lib/auth/role-access.ts:66`, page needs `coupons.view`, but falls back to the
role's static page list) **and** `couponsEnabled` from `GET …/coupons/settings` (a failed settings call defaults to
*enabled*). Static page lists include `coupons` for OWNER, ADMIN, PROGRAM_MANAGER, AFFILIATE_MANAGER, **ANALYST**,
VIEWER. Backend `coupons.view` is granted to OWNER(*), ADMIN, PROGRAM_MANAGER, AFFILIATE_MANAGER, VIEWER — **not ANALYST,
FINANCE, RISK_ANALYST, DEVELOPER**. → ANALYST sees a page whose every API call returns 403. [V, AB]

| # | Element | Opened by / location | API call(s) | Mutates? | Roles that see it | Scenarios |
|---|---|---|---|---|---|---|
| U1 | Page load | nav "Coupons" / `?tab=` | `GET …/coupons/settings`, then `Promise.allSettled` of `GET analytics/overview?period&programId&affiliateId`, `GET /coupons`, `GET analytics/performance?…`, `GET analytics/by-affiliate?programId`, `GET analytics/by-program`, `GET analytics/activity`; separately `GET programs`, `GET affiliates` | no | coupons page roles | A, AB |
| U2 | "Coupons Feature Currently Disabled" banner + **Enable Coupons** button | when settings.couponsEnabled=false | `PUT …/coupons/settings {couponsEnabled:true}` | yes | everyone who sees page (no permission gate in UI; API needs `coupons.settings.update`) | V, AD |
| U3 | Header title "Coupon Intelligence & Management", badge "Real-Time Attribution" | always | — | — | — | AF, K |
| U4 | **Validate Code** button → Validate dialog | header | `GET …/coupons/validate/:code` | no | all page roles | S, U, V |
| U5 | **Refresh** button | header | re-runs U1 batch | no | all | A, AB |
| U6 | **Create Coupon** button → form dialog | header | `POST …/coupons` | yes | **all page roles incl. VIEWER (no UI gate)**; API needs `coupons.create` | D, V, AA |
| U7 | Filter toolbar: Program select ("All Affiliate Programs"+programs) | header | re-runs overview/performance/by-affiliate with `programId` | no | all | B, C, AB |
| U8 | Filter toolbar: Affiliate select ("All Affiliates"+affiliates) | header | overview/performance with `affiliateId` | no | all | B, C, AB |
| U9 | Period segmented control 7D / 30D / 90D / Lifetime (default 30D) | header | overview with `period` (performance **ignores period**) | no | all | B, AB |
| U10 | Tabs: Overview, All Coupons, Performance, Affiliate Attribution, Program Scope, Economics & Impact, Audit Trail (counts on All Coupons, Affiliate Attribution, Program Scope, Audit Trail) | tab bar, URL `?tab=` | — (client) | no | all | A, C |
| U11 | KPI card **Active Coupons** (= `overview.activeCoupons`, "of N total coupons configured", footer Live / Paused / Expired+Archived) | Overview tab | overview | no | all | B, AC |
| U12 | KPI **Total Redemptions** + "redemptionRate% Verified claims" | Overview | overview | no | all | B, M, AC |
| U13 | KPI **Attributed Conversions** + "Avg Order Value (AOV)" | Overview | overview | no | all | B, AC |
| U14 | KPI **Gross Attributed Revenue** "Top of funnel GMV" | Overview | overview | no | all | B, L |
| U15 | KPI **Discount Given** "Discount effective rate" (= discount/gross) | Overview | overview | no | all | B, L |
| U16 | KPI **Affiliate Commission** "Payout ratio" (= commission/gross) | Overview | overview | no | all | B, L |
| U17 | Card "Coupon Financial Economics & Net Yield" (ROI multiple = gross/discount) | Overview | overview | no | all | B, L |
| U18 | Charts: activity trend (Gross Revenue / Redemptions / Discount / Commission tooltip), status distribution donut, "Active ratio" | Overview | overview.activityTrend / statusDistribution | no | all | B, AC |
| U19 | "Active Coupons Inventory" preview table (first 5 rows) + "View Full Table (N)" | Overview | list + performance | no | all | C |
| U20 | **Coupons table** (`coupons-table-section.tsx`) columns: *Coupon Code & Name* (sortable by code, copy button), *Discount Concession* (sortable by value; "N% OFF" / currency "OFF"), *Status* (Expired overrides any status if validUntil < now), *Redemptions & Quota* ("N used / max" or "Unlimited", progress), *Assigned Partners* ("All Affiliates" when 0 assigned, else "N partners" → opens assign dialog), *Validity Window* ("Perpetual" / dates "until …"), actions | All Coupons tab | list + performance(redemptions) | no | all | C, AF |
| U21 | Table client-side search "Search coupons by code or name..." (code, name, description, case-insensitive `includes`) | table | none (client) | no | all | C, AE |
| U22 | Table Status filter: All / Active / Paused / Expired / Archived; Discount filter: All / Percentage / Fixed Amount; "Showing N coupons" | table | none (client) | no | all | C |
| U23 | Table pagination (DataTable, client-side, page sizes 5/10/20/50/100) | table | none — **API returns every coupon, no server pagination** | no | all | C, AE |
| U24 | Row button **Intel** / menu "View Intelligence" → detail drawer | row | `GET …/coupons/:id/analytics` | no | all | A, C |
| U25 | Row menu **Edit Coupon** → form dialog (edit) | row | `PUT …/coupons/:id` | yes | **all (no UI gate)**; API `coupons.edit` | H, V, AA |
| U26 | Row menu **Assign Affiliates** → assign dialog | row | `POST …/:id/assign`, `DELETE …/:id/assign/:affiliateId` | yes | all (no UI gate); API `coupons.assign` | J, V, AA |
| U27 | Row menu **Pause Coupon** / **Activate Coupon** | row | `POST …/:id/status {status}` | yes | all (no UI gate); API `coupons.edit` | I, V, AD |
| U28 | Row menu **Archive Coupon** (trash icon — the only "delete") | row | `POST …/:id/status {ARCHIVED}` (no confirmation dialog) | yes | all (no UI gate); API **`coupons.edit`** (catalog has `coupons.delete` "Archive organization product coupons", unused) | I, V |
| U29 | Empty table state "No coupons found" / "Create your first promotional discount coupon…" + **Create First Coupon** | table | `POST` via dialog | yes | all | AC |
| U30 | **Form dialog** (create/edit) fields: Coupon Code * (upper-cased as typed, disabled when editing) + **Auto** generator (client-side, `SAVE`+6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, no uniqueness check), Coupon Name *, Description, Discount Type (Percentage / Fixed Amount (INR)), Discount Value * "(1 - 100%)" or "(INR)", Max Redemptions ("Unlimited" placeholder), Valid From (date), Valid Until (date), "Assign to Specific Affiliates (Optional)" checklist + filter (create only, "All affiliates can share" when none). Client validation: code ≥2 after trim/uppercase/strip-spaces; name ≥2; value >0; % ≤100. Buttons Cancel / X / Save Changes or Create Coupon; inline error box | U6/U25 | POST / PUT | yes | see U6/U25 | D, E, G, H, W, AA |
| U31 | **Detail drawer** (`coupon-detail-sheet.tsx`): code + copy, status chip, name, description ("No description provided…"), Discount Concession, Validity Window, Redemption Quota "N / max (pct%)" or "N claimed (Unlimited)", metrics Redemptions / Gross Revenue / Discount Given / Net Margin / Commission Generated / AOV, Assigned Affiliates list ("No specific affiliates assigned. This coupon is eligible across all partners."), Recent Orders Attributed (orderId, customerEmail, "via affiliate", amount, "- discount") or "No conversions attributed to this coupon yet." | U24 | analytics | no | all | C, J, L, M, AA |
| U32 | **Assign dialog**: search "Search affiliates by name or email...", per affiliate Assign / Remove buttons (each click is an immediate API call), Done | U26 / Assigned Partners cell | assign / unassign | yes | all | J, AA |
| U33 | **Validate dialog** "Real-Time Coupon Eligibility Validator": code input (upper-cased), result valid/invalid + reason + coupon details | U4 | validate | no | all | S |
| U34 | Performance tab: top cards (top revenue coupon, by redemptions "N claims", by AOV, "No data yet"), sort select Gross Revenue / Redemption Count / Discount Given / Average Order Value, rankings table with **Inspect** | tab | performance (`sortBy`) — UI re-sorts client-side | no | all | C, B |
| U35 | Affiliate Attribution tab: per affiliate assigned coupon count, codes, redemptions, revenue, discount, commission, AOV | tab | by-affiliate | no | all | B, J, K |
| U36 | Program Scope tab: per program active coupons, redemptions, revenue, discount, commission | tab | by-program | no | all | B |
| U37 | Economics & Impact tab: gross/discount/commission breakdown, "No sales yet", "Automated Economics Advisor" tips | tab | overview + performance | no | all | B, AF |
| U38 | Audit Trail tab: last 50 coupon audit rows (action, code, actor, time) | tab | activity | no | all | AD |
| U39 | Toasts: "Coupon code X copied to clipboard", "Coupon X created successfully", "updated successfully", "X has been activated/paused/archived.", "Affiliate assigned to coupon", "Affiliate unassigned from coupon", "Failed to …" errors | various | — | — | all | D, H, I, AB |
| U40 | Loading states: KPI values "...", table `loading`, drawer "..." | various | — | — | all | AB |
| U41 | Error state on load: **none** — `Promise.allSettled` failures are ignored silently, KPIs fall back to `?? 0` (fake zeros) | U1 | — | — | all | AB |
| U42 | Program form → Attribution → "Collision Priority": Promo Code Wins (Coupon Affiliate) / Tracking Link Wins (Click Affiliate) / Last Touch (stores `programs.couponAttributionPriority`, default `PROMO_CODE`) | Programs page | `POST/PUT programs` | yes | program editors | K, AF |
| U43 | Program form → Terms → "Allow Coupon & Deal Aggregators" (`allowCouponSites`) | Programs page | programs | yes | program editors | AF |

Not present in the admin UI (so scenarios that need them are N/A or BLOCKED): **no bulk import, no CSV export, no hard
delete, no per-customer limit field, no per-affiliate limit field, no program selector on a coupon (coupons are not linked
to programs), no server-side search/sort/pagination, no "affiliate requests a code" flow**. [G, Z, I, M, R]

### 1.2 Affiliate portal (partner-iq-affiliate-portal)

Fields the portal reads from `GET /api/v1/affiliate/me/assigned-coupons` (`src/lib/api/coupons.ts`) — **this is the
backend↔portal contract**: `id`, `organizationId`, `code`, `description`, `discountType`, `discountValue`, `validUntil`
(declared but unused: `name`, `validFrom`). Request: query `organizationId` (optional) + header `x-organization-id`.
Everything else the portal shows is hard-coded in the client mapper: `uses: 0`, `conversions: 0`, `revenueGenerated: 0`,
`commissionEarned: 0`, `status: 'ACTIVE'`, `programId: ''`. Fixed-amount summary uses a hard-coded **`$`**.

| # | Element | API | Mutates? | Who | Scenarios |
|---|---|---|---|---|---|
| P1 | Page `/coupons` and `/o/:slug/coupons` "Exclusive Promo Codes & Coupons" ("Dedicated promotional coupon codes assigned to you by {org}.") | assigned-coupons (cached, `fetchWithDedup`) | no | logged-in affiliate | R, A |
| P2 | Coupon card: discount summary (description or "N% off" / "$N off"), "Status: ACTIVE" (always), code + **Copy** button, stats Uses / Sales / Earned (always 0), footer "Direct Coupon Attribution" + "Active" | — | no | affiliate | R, AF |
| P3 | Loading "Loading coupons..."; empty "No Coupons Assigned Yet" / "Custom promo codes for this organization will appear here once configured by the partner manager."; StaleDataBanner(sections=coupons) | — | no | affiliate | R, AC, AB |
| P4 | Org dashboard block "Your Exclusive Promo Codes" — "Coupons track directly to your affiliate balance", per coupon "N redemptions • ₹0 earned" (always 0), Copy, **Manage** → coupons page, empty "No custom promo codes assigned yet. Check back or request one from the brand manager." | same data | no | affiliate | R, AF |

No portal flow lets an affiliate request or create a code (R: "request own codes" → N/A).

---------------------------------------------------------------------------------------------------------------------
## 2. UI claims (text that promises behaviour)

| # | Claim (verbatim) | Where | What the code actually does (Phase 1 reading) | Scenario |
|---|---|---|---|---|
| C1 | "Real-Time Attribution" | admin header badge | Nothing attributes sales to coupons when they are recorded; KPIs are computed at read time by matching `conversion.metadata.couponCode` | K, AF |
| C2 | "track affiliate redemption ROI, verify eligibility in real time, and monitor revenue impact" | admin header | redemptions are inferred, not recorded (see R4) | K, M, AF |
| C3 | "Verify whether a promotional code is currently valid, active, within its date window, and below its redemption quota." | validate dialog | true for the admin tool only; **nothing enforces it at sale time** | I, M, P, S |
| C4 | "Max Redemptions" / "Unlimited" / "N used / max" / "Redemption Quota" | form/table/drawer | limit never enforced when a sale is recorded | M, N |
| C5 | "Valid From" / "Valid Until" / "Perpetual" / "Expired" | form/table | dates never enforced at sale; UI sends `new Date('YYYY-MM-DD').toISOString()` = **UTC midnight**, so "Valid Until 10 Oct" ends at 00:00 UTC 10 Oct (05:30 IST), i.e. the chosen end day is excluded | P |
| C6 | "All Affiliates" (Assigned Partners cell when 0 assigned), "All affiliates can share", "No specific affiliates assigned. This coupon is eligible across all partners." | table/form/drawer | unassigned coupons are not assigned to anyone; affiliates never see them in the portal; credit still not given | K, R, AF |
| C7 | "Designate which affiliates can view and distribute this promotional coupon code." | assign dialog | true for portal visibility (ACTIVE only) | R, J |
| C8 | "Collision Priority: Promo Code Wins (Coupon Affiliate) / Tracking Link Wins / Last Touch" | program form | `couponAttributionPriority` is stored but **never read** by conversion code | K, AF |
| C9 | "Coupons are disabled … Affiliates will not be able to view or distribute promo codes." | banner | `listForAffiliate` returns [] when disabled — true for viewing | R |
| C10 | "Setting maximum redemptions per coupon prevents budget overruns and viral coupon leaks…" | Economics advisor | limit not enforced → claim false | M, AF |
| C11 | "Coupons track directly to your affiliate balance" | portal dashboard | no coupon→commission linkage; portal stats hard-coded 0 | K, R, AF |
| C12 | "Direct Coupon Attribution" / "Status: ACTIVE" / "Active" | portal card | always printed, even for an expired (validUntil past) coupon — backend filters status only | P, R, AF |
| C13 | "Uses / Sales / Earned" = 0, "N redemptions • ₹0 earned" | portal | hard-coded zeros ("Redemption tracking isn't implemented yet" comment in code) | R, AF |
| C14 | "$N off" | portal fixed discount summary; backend email `formatDiscount` | currency hard-coded `$` while orgs are INR | R, AF |
| C15 | "Archive Coupon" (trash icon) | table menu | sets status ARCHIVED; no hard delete exists | I |
| C16 | Email template "Your affiliate coupon is ready: {{couponCode}}" / "Share {{couponCode}} … for {{discount}} off" | email on assign | sent via email dispatch with `$` discount; `programName` filled with **coupon name** | J, AF |
| C17 | "Recent Orders Attributed … customer@partneriq.in" | drawer | backend substitutes the literal `customer@partneriq.in` when a conversion has no email (fabricated data shown to admin) | L, AF |
| C18 | "Coupon code must be at least 2 characters." etc. | form errors | backend also MinLength(2); no max length (DB varchar(60)), no charset rule | E, W |

No "unique codes", "syncs with Shopify", or "coming soon" text exists for org coupons (searched `src/components/coupons`,
`src/components/pages/coupons-view.tsx`, portal `CouponsView.tsx`/`OrgDashboardView.tsx`).

---------------------------------------------------------------------------------------------------------------------
## 3. API list (backend)

All admin routes: `@Controller('api/v1/organizations/:organizationId/coupons')` + `@UseGuards(JwtAuthGuard,
OrganizationGuard, PermissionsGuard)` (`coupons.controller.ts`). Org isolation: `OrganizationGuard` checks the caller is a
member of `:organizationId`; the service additionally filters every `dbStore` read by `organizationId` and
`requireCoupon(orgId, couponId)` (404 for another org's coupon). Every service method first calls
`assertCouponsEnabled(orgId)` (403 when disabled). **Every method uses `dbStore` (in-memory `DBBackedArray`), none uses a
TypeORM repository directly.**

| Method | Path | Permission | Service method | Storage | Scenarios |
|---|---|---|---|---|---|
| GET | `/settings` | coupons.view | `getSettings` | dbStore.organizationCouponSettings | A, V |
| PUT | `/settings` | coupons.settings.update | `upsertSettings` (+ audit COUPON_SETTINGS_UPDATED) | dbStore | V, AD |
| GET | `/analytics/overview?period&dateFrom&dateTo&programId&affiliateId` | coupons.view | `getAnalyticsOverview` | dbStore (coupons, conversions, commissions) | B |
| GET | `/analytics/performance?programId&affiliateId&sortBy` | coupons.view | `getPerformanceAnalytics` | dbStore | B, C |
| GET | `/analytics/by-affiliate?programId` | coupons.view | `getAffiliatePerformance` | dbStore | B, J |
| GET | `/analytics/by-program` | coupons.view | `getProgramPerformance` | dbStore | B |
| GET | `/analytics/activity?couponId` | coupons.view | `getActivityLog` | dbStore.auditLogs | AD |
| GET | `/validate/:code` | coupons.view | `validateCouponCode` | dbStore | S |
| GET | `/` | coupons.view | `list` | dbStore | C, AE |
| POST | `/` | coupons.create | `create` (+ optional `assign`) | dbStore | D, E, F, W, X |
| GET | `/:couponId/analytics` | coupons.view | `getCouponDetailAnalytics` | dbStore | L, M |
| GET | `/:couponId` | coupons.view | `get` | dbStore | U |
| PUT | `/:couponId` | coupons.edit | `update` | dbStore | H, X |
| POST | `/:couponId/status` | coupons.edit | `changeStatus` | dbStore | I |
| POST | `/:couponId/assign` | coupons.assign | `assign` (+ email) | dbStore | J |
| DELETE | `/:couponId/assign/:affiliateId` | coupons.assign | `unassign` (hard-deletes assignment row via splice) | dbStore | J |
| GET | `/api/v1/affiliate/me/assigned-coupons?organizationId` (also `/affiliate/me/…`) | JwtAuthGuard only (any user JWT) | `AffiliateCouponsController` → `listForAffiliate` | dbStore.affiliates (match by `userId` or **email**) | R |

Sale-recording endpoints that carry coupon codes (not in the coupons module):

| Method | Path | Auth | Coupon handling | Scenarios |
|---|---|---|---|---|
| POST | `/api/v1/conversions` | ApiKeyGuard (`conversions:write`, org taken from key, test/live env from key prefix), optional `Idempotency-Key` | **none** — `metadata.couponCode` stored as opaque JSON | K, L, M, N, O, P, T |
| POST | `/api/v1/conversions/:id/refund` | ApiKeyGuard (`refunds:write`) | none | Q |
| POST | `/api/v1/organizations/:orgId/conversions/manual` | JWT `manage.conversions` | none | K |
| POST | `/api/v1/integrations/:provider/webhooks/:publicConnectionId` | provider signature | bridges PAYMENT_SUCCESS into `createConversion` **without any coupon field** | T |

---------------------------------------------------------------------------------------------------------------------
## 4. Business rules as written in the code

| # | Rule | Code says | Where | Scenarios |
|---|---|---|---|---|
| R1 | Code characters | any string; `@IsString @MinLength(2)`; no charset, no max length (DB `varchar(60)` → longer codes fail only in the background DB write) | `dto/coupon.dto.ts:6-8` | E, W, Y |
| R2 | Case / spaces | `normalizedCode = code.trim().toUpperCase().replace(/\s+/g,'')`; stored `code = dto.code.trim()` (original case and inner spaces kept) | `coupons.service.ts:16,121` | E |
| R3 | Uniqueness | per organization on `normalizedCode`, checked in memory (`find`) **and** DB `UNIQUE KEY (organizationId, normalizedCode)` exists. Archived codes still block reuse | service `create`, `SHOW CREATE TABLE` | E, F, I |
| R4 | Discount types | `PERCENTAGE` (int 1–100) / `FIXED_AMOUNT` (int ≥1, **major units** e.g. ₹20; converted ×100 to paise for analytics). `@IsInt` → 12.5 % or ₹99.50 impossible | dto + `assertDiscountValue`, `calculateDiscount` | L, W |
| R5 | Usage limits | `maxRedemptions` (total) only; **no per-customer, no per-affiliate limit**. A "use" is not recorded anywhere: at read time a conversion counts as a redemption of coupon C if `metadata.couponCode|promoCode|coupon_code|code|coupon` normalizes to C's code, **or** the conversion has no code at all and its affiliate is assigned to C | `getConversionsForCoupon` | M, N, B |
| R6 | When counted / refunds | counted at read time over all conversions regardless of status (incl. REJECTED/REFUNDED) for `totalRedemptions` and validate; refunds never "give back" because nothing is stored | analytics | M, Q |
| R7 | Dates & timezone | `validFrom`/`validUntil` stored as `timestamp` instants, compared with `new Date()` (UTC instant) only in the validate endpoint; org timezone (`organization_settings.timezone`, default `America/New_York`) is never used | `validateCouponCode` | P |
| R8 | Who gets credit | `createConversion` resolves affiliate from attribution (click/cookie) → `clickId` → `metadata.affiliateId` → **the org's only active affiliate if exactly one exists**; coupon code is ignored. `programs.couponAttributionPriority` (default `PROMO_CODE`) is never read | `conversions.service.ts:836-864` | K |
| R9 | Commission base | `commission = round(conversion.amount × bps / 10000)` on the `amount` the merchant sends; no discount field exists. Coupon analytics treat `amount` as **gross pre-discount** (discount = amount × %, net = amount − discount) — i.e. if merchants send the amount actually paid, every coupon KPI overstates revenue and discount | `commissions.service.ts:466-474`, `coupons.service.ts:752-759` | L |
| R10 | Discount after the fact | discount figures are recomputed from the coupon's **current** type/value — editing the discount rewrites history | `calculateDiscount` at read time | H, L |
| R11 | Moving a coupon | assignments are many-to-many; unassign deletes the row. Past conversions keep their own `affiliateId`; but "redemptions" for an affiliate are computed through current assignments, so unassigning AFFILIATE_1 drops their past coupon sales from by-affiliate analytics | `getAffiliatePerformance` | J |
| R12 | Program membership | coupons have no program; `assign` only checks the affiliate belongs to the org, not to any program | `assign` | J |
| R13 | Delete | no delete endpoint; ARCHIVED status (soft); archived code cannot be reused (R3) | — | I |
| R14 | Status | ACTIVE / PAUSED / ARCHIVED; any transition allowed incl. ARCHIVED→ACTIVE | dto | I |
| R15 | Outside systems | none create coupons. Sales with codes arrive through the API-key conversions API (key hash lookup, scope `conversions:write`, org from key). Payment-provider webhooks (Cashfree/Razorpay, HMAC verified in adapters) create conversions without coupon info. No Shopify/Stripe coupon sync exists | `api-key.guard.ts`, `integrations.service.ts:985-1003` | T |
| R16 | Duplicate sales | `externalId` duplicate check is in memory only (no DB unique on conversions.externalId); idempotency keys stored via dbStore | `createConversion` | O |
| R17 | Validation order | `create`: pushes the coupon to dbStore **before** assigning affiliates → an unknown affiliateId returns 404 but the coupon stays. `update`: mutates fields **before** the `validFrom >= validUntil` check → 400 but changes saved | `coupons.service.ts:135-141, 154-163` | X, W, H |
| R18 | Audit | `audit_logs` rows via dbStore: COUPON_CREATED {code}, COUPON_UPDATED {fields: keys only — no before/after}, COUPON_STATUS_CHANGED {status}, COUPON_ASSIGNED {affiliateIds}, COUPON_UNASSIGNED, COUPON_SETTINGS_UPDATED | `audit()` | AD |

---------------------------------------------------------------------------------------------------------------------
## 5. Places where the UI promises something the code doesn't do

1. Usage limits, start/end dates and paused/archived status are not enforced when a sale is recorded (C3, C4, C5, C10). [I, M, N, P]
2. Coupon-based attribution does not exist; "Promo Code Wins" priority is ignored (C1, C8, C11). [K]
3. Unassigned coupons are labelled "All Affiliates / eligible across all partners" (C6) — nobody is credited and no affiliate sees them. [K, R]
4. End date excludes the chosen day and uses UTC, not the org timezone (C5). [P]
5. Portal Uses/Sales/Earned always 0 and "Active" for expired coupons; `$` currency (C11–C14). [R]
6. Detail drawer shows a fabricated `customer@partneriq.in` (C17). [L]
7. Discount KPIs are recomputed from the current discount (R10) and assume pre-discount amounts (R9). [H, L]
8. VIEWER sees and can click Create/Edit/Assign/Pause/Archive (API refuses); ANALYST gets the page but every call is 403 (§1.1). [V]
9. Load failures render as zeros, not errors (U41). [AB]

---------------------------------------------------------------------------------------------------------------------
## 6. In-memory store (dbStore) facts relevant to coupons

- `organizationCoupons`, `organizationCouponAssignments`, `organizationCouponSettings`, `conversions`, `commissions`,
  `auditLogs` are all `DBBackedArray`s loaded once at boot (`store.ts:970-981`).
- `push` starts an `upsert` in the background; property assignment through the Proxy starts another full-row `upsert`
  per assigned property; failures are caught and only `console.error('dbStore save error:', …)` (`store.ts:469-471,
  517-519`). No coupon method calls `awaitPersist`, so **coupon HTTP responses never wait for MySQL** — a failed write
  returns 2xx and memory/MySQL diverge until restart. [X, Y]
- This version of `store.ts` has no `throw err` inside the `.catch` handlers (`grep -n "throw err" src/database/store.ts`
  → no match), so the Node-24 crash risk from the prompt is not present in this checkout. [Y]
- Multiple concurrent upserts of the same row can land out of order (lost update). [N, Y]

---------------------------------------------------------------------------------------------------------------------
## 7. Billing-coupon boundary (report only)

- Tables: org coupons use `organization_coupons`, `organization_coupon_assignments`, `organization_coupon_settings`;
  billing uses `billing_coupons`, `billing_coupon_plans`, `billing_coupon_organizations`, `billing_coupon_redemptions`,
  `billing_subscription_discounts`. **No shared coupon table.** Shared generic tables: `audit_logs` (different
  `resourceType`), permission catalog (`coupons.*` vs `billing.coupons.*`).
- Services: no import in either direction (`grep OrganizationCoupon src/modules/billing` and `grep BillingCoupon
  src/modules/coupons src/modules/conversions` → no match). `normalizeCode` is duplicated with the identical algorithm in
  `billing-coupon-validation.service.ts:25` and `coupons.service.ts:16` — not shared code.
- Code-check endpoints: org `GET /organizations/:id/coupons/validate/:code`; billing
  `POST /organizations/:id/billing/coupons/validate`. Cross-application tests are in scenario S/T (Phase 3).
