# Organization coupons audit — final report (Phase 5)

Scope: organization product coupons (`organization_coupons*`, `/api/v1/organizations/:id/coupons/*`,
`/api/v1/affiliate/me/assigned-coupons`) in **partner-iq-backend**, **partner-iq-frontend** (admin) and
**partner-iq-affiliate-portal** (coupon screens/API only, user decision 1). SaaS billing coupons are out of scope; only
the boundary is reported (§9, user decision 2). Branch `audit/coupons` in all three repos.

Environment: MySQL 8.0.46 test database `partneriq_coupons_audit` (built by this audit, no real data), backend compiled
(`npm run build && npm start`), admin UI = production build (`vite build` + `vite preview`, decision D21), Playwright
1.56.1 / Chromium 141, Node 22.22.0. Test data prefix `e2e-cpn-1791051925353`, run id `MUSQ2MAX` (fixtures:
`docs/coupons-phase2-fixtures.md`). Raw proof: `docs/coupons-proof/<letter>.txt` (after fixes) and
`docs/coupons-proof/baseline/<letter>.txt` (before fixes). Every proof file is appended per run and starts each run with
`run=<id>`; the latest run is at the bottom.

Related documents: inventory `docs/coupons-inventory.md`, decisions `docs/decisions.md` (D1–D25), progress log
`docs/coupons-progress.md`.

---------------------------------------------------------------------------------------------------------------------
## 1. Inventory, UI claims and business rules → scenario letters

The full inventory (screens, controls, API list, field-by-field portal contract) is `docs/coupons-inventory.md` §1–§3;
every row there carries its scenario letters. Summary:

**Storage (prompt: "dbStore or repositories?").** Before the audit every coupon service method used `dbStore` only.
After the audit:

| Code | Writes | Reads |
|---|---|---|
| `coupons.service.ts` create / update / status / assign / unassign / settings | **MySQL first** in a transaction (`inTx`, 5 s lock wait, 503 on failure), then the in-memory `dbStore` copy | `dbStore` (list/get/decorate), MySQL for usage counts and all analytics (`aggregate()` over `organization_coupon_redemptions ⋈ conversions ⋈ commissions`) |
| `coupon-redemption.service.ts` (new) — coupon use at sale time, refunds | MySQL only (`organization_coupon_redemptions`, `organization_coupon_usage` with `SELECT … FOR UPDATE`) | MySQL; coupon/affiliate/program lookups from `dbStore` |
| `coupon-rules.ts` (new) | — | org timezone from MySQL `organization_settings` (30 s cache), fallback `dbStore`, then UTC |
| `affiliate-coupons.controller.ts` | — | `dbStore` + usage/earnings from MySQL |
| audit rows (`audit_logs`) | still `dbStore.auditLogs.push` (background write — see §5) | `dbStore` |
| conversions / commissions created at sale time | still `dbStore` (conversions module, outside coupon scope — see §5) | `dbStore` |

No coupon code uses a TypeORM repository object; MySQL access is `DataSource`/`QueryRunner` SQL.

**UI claims (AF).** Each claim from inventory §2, the scenario that proved/disproved it, and the state after the fixes:

| # | Claim | Before (proof) | After | Scenario |
|---|---|---|---|---|
| C1 | "Real-Time Attribution" | FALSE — nothing attributed coupon sales | TRUE — the sale is credited at record time (`coupon.applied`, redemption row) | K |
| C2 | "track affiliate redemption ROI, verify eligibility in real time…" | FALSE — uses inferred at read time | TRUE — uses recorded; KPIs from SQL | B, K, M |
| C3 | "Verify whether a promotional code is currently valid, active, within its date window, and below its redemption quota." | admin tool only; sale ignored it | TRUE — the same rules are enforced when the sale is recorded | I, M, P, S |
| C4 | "Max Redemptions" / "N used / max" | FALSE — never enforced | TRUE — atomic limit | M, N |
| C5 | "Valid From / Valid Until / Expired" | FALSE — not enforced; end day excluded (UTC midnight) | TRUE — org timezone, end inclusive to 23:59:59 | D, P |
| C6 | "All Affiliates … eligible across all partners" | FALSE — nobody credited, no affiliate sees it | **Text changed** to "Unassigned" (D4b, D25 — for your review) | K, R |
| C7 | "Designate which affiliates can view and distribute…" | TRUE | TRUE | J, R |
| C8 | "Collision Priority: Promo Code Wins / Tracking Link Wins / Last Touch" | FALSE — setting never read | TRUE — read per program (D4) | K |
| C9 | "Coupons are disabled … Affiliates will not be able to view…" | TRUE for viewing | TRUE; also blocks use at sale (`COUPONS_DISABLED`) | R |
| C10 | "Setting maximum redemptions … prevents budget overruns" | FALSE | TRUE | M, N |
| C11 | "Coupons track directly to your affiliate balance" | FALSE | TRUE — commission to the coupon's affiliate, shown in portal | K, R, Q |
| C12 | Portal "Status: ACTIVE" | FALSE for expired coupons | **Text changed**: expired → "Expired — do not share" (D25) | P, R |
| C13 | Portal "Uses / Sales / Earned" | FALSE — hard-coded 0 | TRUE — real values | R |
| C14 | "$N off" (portal + assignment email) | FALSE — `$` for INR orgs | TRUE — org/coupon currency | R |
| C15 | "Archive Coupon" | TRUE (soft) but reversible | TRUE; archive is terminal, needs `coupons.delete` | I, V |
| C16 | Email "Your affiliate coupon is ready" (`programName` = coupon name) | TRUE — template documents `programName` as "Coupon or promotion name" | unchanged | J |
| C17 | Drawer customer `customer@partneriq.in` | FALSE — fabricated | **Text changed** to "Customer email not reported" (D25) | L |
| C18 | "Coupon code must be at least 2 characters" | partly — no max/charset | TRUE + 40-char max and charset rule, same in UI and API | E, W |

**Business rules (inventory §4 → after the audit):**

| # | Rule as found | Rule now | Decision | Scenario |
|---|---|---|---|---|
| R1/R2 | any string ≥ 2, case kept | trim, uppercase, `^[A-Z0-9][A-Z0-9_-]{1,39}$`, non-ASCII rejected | D3, D3b | E, W |
| R3 | unique per org (DB key existed) | unique (organizationId, normalizedCode), incl. archived; 409; race-safe | D3 | E, F |
| R4 | integer % / integer major units | 2-decimal `discountValueExact` (12.5 %, ₹99.50) | D6 | L |
| R5 | total limit only, never enforced | total + per-customer (customer id, else normalized email), enforced atomically | D7, D7b | M, N |
| R6 | counted at read time incl. rejected/refunded | counted when the sale is recorded; refunds keep the use | D7 | M, Q |
| R7 | UTC instants, validate endpoint only | org timezone, end inclusive, checked at the sale's `occurredAt` | D10 | P |
| R8 | click → … → "only active affiliate" fallback, coupon ignored | coupon affiliate per `couponAttributionPriority`; no fallback guess for coupon sales | D4, D4b | K |
| R9/R10 | discount recomputed from the current coupon | discount stored per sale; commission on the paid amount | D5, D6 | H, L |
| R11 | by-affiliate history followed current assignment | history stays with the affiliate credited at sale time | D9 | J |
| R12 | coupons have no program | unchanged; commission uses the credited affiliate's program | D4 | J, K |
| R13/R14 | ARCHIVED reversible, any transition | ARCHIVED terminal; code never reusable | D9b | I |
| R15 | webhooks carry no coupon | unchanged (report only) | — | T |
| R16 | duplicate sale check in memory | unchanged for conversions (outside scope); coupon use is unique in MySQL per order id | D7b | O |
| R17 | 4xx left rows behind | validation before any write | — | X, W, H |
| R18 | audit without before/after | before/after snapshots | — | AD |

---------------------------------------------------------------------------------------------------------------------
## 2. Results table

API = HTTP behaviour; DB = MySQL checked with SQL in the test; UI = admin or portal browser check; Refresh = the UI
check was repeated after a full page load / backend restart (memory re-read from MySQL). Final run:
`docs/coupons-proof/<letter>.txt` (latest `run=`), raw Playwright output in §10.

| Letter | Description | API | DB | UI | Refresh | Proof |
|---|---|---|---|---|---|---|
| A | Page load (OWNER, VIEWER): GET only, no duplicates, no console errors, no Org B data | PASS | N/A (read-only page) | PASS | PASS | `coupons-proof/A.txt` |
| B | KPI cards vs SQL (7D/30D/Lifetime, affiliate/program filters) | PASS | PASS | PASS | PASS | `coupons-proof/B.txt` |
| C | Table: every column vs SQL, search, filters, sorting, pagination | PASS | PASS | PASS | PASS | `coupons-proof/C.txt` |
| D | Create PERCENTAGE + FIXED through the UI; DB row, org-timezone dates, audit | PASS | PASS | PASS | PASS | `coupons-proof/D.txt` |
| E | Code rules (14 rejects), normalisation, duplicates incl. archived, other org | PASS | PASS | N/A (API rule; UI mirrors it, see D/G) | N/A | `coupons-proof/E.txt` |
| F | Duplicate-code race (identical + case/space variants) | PASS | PASS | N/A (API race) | N/A | `coupons-proof/F.txt` |
| G | Code generator: 200 codes, alphabet, never an existing code; bulk import | PASS (generator) | PASS | PASS | N/A — no bulk import exists | `coupons-proof/G.txt` |
| H | Edit every field; invalid edit changes nothing; used coupon history unchanged | PASS | PASS | N/A (dialog covered by AA) | N/A | `coupons-proof/H.txt` |
| I | Paused / archived / expired refused at sale; reactivate; archive instead of delete | PASS | PASS | N/A (API behaviour) | N/A | `coupons-proof/I.txt` |
| J | Move coupon A1 → A2: past sales stay; cross-org assign refused | PASS | PASS | N/A (both portals checked via their APIs) | N/A | `coupons-proof/J.txt` |
| K | Who gets credit (no click, other link clicked, priority AFFILIATE, unassigned, other org) | PASS | PASS | N/A | N/A | `coupons-proof/K.txt` |
| L | Discount and commission math (6 cases + derived discount) | PASS | PASS | N/A | N/A | `coupons-proof/L.txt` |
| M | Total limit 3, per-customer by id and by email; UI "3 used / 3" | PASS | PASS | PASS | PASS | `coupons-proof/M.txt` |
| N | Last-use race: 10 parallel sales on the 5th use | PASS | PASS | N/A | N/A | `coupons-proof/N.txt` |
| O | Same sale twice (sequential, 10 concurrent, idempotency key) | PASS | PASS | N/A | N/A | `coupons-proof/O.txt` |
| P | Start/end boundaries in IST and UTC orgs (11 instants) | PASS | PASS | N/A (display covered by D) | N/A | `coupons-proof/P.txt` |
| Q | Partial/full refund; refund after payout → negative balance shown to admin | PASS | PASS | N/A (admin balance checked via API) | N/A | `coupons-proof/Q.txt` |
| R | Affiliate portal: own coupons only, contract keys, tampering, uses/earned = admin = SQL | PASS | PASS | PASS | PASS | `coupons-proof/R.txt` |
| S | Code-check endpoint (admin tool): no affiliate data in any answer, other org's code = "does not exist", 403 for non-members/no permission, 429 after 30/min; reasons stay specific (D13) | PASS | N/A (read-only) | N/A | N/A | `coupons-proof/S.txt` |
| S4 | Billing boundary: org code at billing checkout, billing code on an affiliate sale | PASS | PASS | N/A | PASS (after restart) | `coupons-proof/S-billing.txt` |
| T | API keys (missing/bad/revoked/other org), replay; provider webhooks | PASS | PASS | N/A | N/A — T3 signed connected webhook **BLOCKED** (no credentials) | `coupons-proof/T.txt` |
| U | Organization isolation: Org B token on every Org A coupon route | PASS | PASS | N/A | N/A | `coupons-proof/U.txt` |
| V | Permissions: role × API matrix; UI controls per role | PASS | N/A | PASS | N/A | `coupons-proof/V.txt` |
| W | Bad input and extra fields (30 cases) | PASS | PASS | N/A | N/A | `coupons-proof/W.txt` |
| X | Rejected requests leave nothing in memory or MySQL | PASS | PASS | N/A | PASS (memory == SQL) | `coupons-proof/X.txt` |
| Y | MySQL write blocked (create, edit, on/off switch): no false success | PASS | PASS | N/A | PASS (after restart) | `coupons-proof/Y.txt` |
| Z | CSV export: values vs SQL, formula guard, BOM | PASS (n/a: client-side) | PASS | PASS | N/A | `coupons-proof/Z.txt` |
| AA | Cancel/close every dialog and the drawer: nothing sent, nothing saved | PASS | PASS | PASS | N/A (nothing saved) | `coupons-proof/AA.txt` |
| AB | 500 / 403 / network / broken JSON / 3 s delay + fast filter changes | PASS | PASS | PASS | N/A | `coupons-proof/AB.txt` |
| AC | Empty organization: zeros, empty states, no NaN | PASS | N/A (no rows) | PASS | N/A | `coupons-proof/AC.txt` |
| AD | Audit rows for create/edit/status/move/archive with before/after | PASS | PASS | N/A | N/A | `coupons-proof/AD.txt` |
| AE | 50,000 coupons + 55,000 uses: p50/p95 over 20 runs, memory (200,000 **BLOCKED**, D17) | PASS | PASS | N/A (API timings requested) | PASS (boot from MySQL) | `coupons-proof/AE.txt` |
| AF | UI claims → scenarios | see §1 | — | — | — | §1 |

Baseline before fixes: `docs/coupons-proof/baseline/` (summary in `docs/coupons-progress.md`, Phase 3). Final run: **126 passed, 0 failed** (§10).

---------------------------------------------------------------------------------------------------------------------
## 3. Math, limits, dates, permissions

### 3.1 Discount and commission math (L)

Hand math first (paise; commission = paid × 750 bps, round half up), then API, SQL and stored rows
(`docs/coupons-proof/L.txt`). Program pA1 = 7.5 %.

| Case | Coupon | Price before | Hand math | Discount (API/SQL) | Paid | Commission (SQL) |
|---|---|---|---|---|---|---|
| PCT10 | PERCENTAGE 10 | 1000.00 | discount 10000, paid 90000, 7.5 % = 6750.000 → 6750 | 10000 ✓ | 90000 | 6750 ✓ |
| FIX200 | FIXED_AMOUNT 200 | 1000.00 | discount 20000, paid 80000, 7.5 % = 6000.000 → 6000 | 20000 ✓ | 80000 | 6000 ✓ |
| ROUND | PERCENTAGE 12.5 | 999.99 | discount 12500, paid 87499, 7.5 % = 6562.425 → 6562 | 12500 ✓ | 87499 | 6562 ✓ |
| FIXBIG | FIXED_AMOUNT 1500 | 1000.00 | discount 100000, paid 0, 7.5 % = 0.000 → 0 | 100000 ✓ | 0 | 0 ✓ |
| FREE | PERCENTAGE 100 | 499.00 | discount 49900, paid 0, 7.5 % = 0.000 → 0 | 49900 ✓ | 0 | 0 ✓ |
| FIXDEC | FIXED_AMOUNT 99.5 | 250.00 | discount 9950, paid 15050, 7.5 % = 1128.750 → 1129 | 9950 ✓ | 15050 | 1129 ✓ |
| derived | PERCENTAGE 10, no `orderSubtotal` | — | paid 90000 → gross round(90000×100/90) = 100000, discount 10000 | 10000 ✓ | 90000 | — |

All amounts in paise. ✓ = API, stored redemption row and commission row equal the hand math (raw rows in the proof).

Rounding: discount and commission are rounded half away from zero to the paisa (D6). A fixed discount larger than the
price makes the order ₹0.00; ₹0 orders count as a use and earn no commission (D18).

### 3.2 Usage limits (M) and last-use race (N)

```
# Scenario M — raw proof, run=1791062315582 (started 2026-10-03T21:18:35.699Z)
==== M1 total limit 3 ====
CHECK PASS step 1 HTTP (sale is always recorded): actual=201 expected=201
CHECK PASS step 1 coupon.applied: actual=true expected=true
CHECK PASS step 1 SQL uses: actual=1 expected=1
CHECK PASS step 1 API remaining: actual=2 expected=2
CHECK PASS step 2 HTTP (sale is always recorded): actual=201 expected=201
CHECK PASS step 2 coupon.applied: actual=true expected=true
CHECK PASS step 2 SQL uses: actual=2 expected=2
CHECK PASS step 2 API remaining: actual=1 expected=1
CHECK PASS step 3 HTTP (sale is always recorded): actual=201 expected=201
CHECK PASS step 3 coupon.applied: actual=true expected=true
CHECK PASS step 3 SQL uses: actual=3 expected=3
CHECK PASS step 3 API remaining: actual=0 expected=0
CHECK PASS step 4 HTTP (sale is always recorded): actual=201 expected=201
CHECK PASS step 4 coupon.applied: actual=false expected=false
CHECK PASS step 4 SQL uses: actual=3 expected=3
CHECK PASS step 4 API remaining: actual=0 expected=0
CHECK PASS 4th sale: no redemption row: actual=false expected=false
CHECK PASS UI "used" text: actual=true expected=true
==== M2 per-customer limit ====
CHECK PASS same customer 1st: actual=true expected=true
CHECK PASS same customer 2nd: actual=false expected=false
CHECK PASS other customer: actual=true expected=true
==== M3 per-customer by email ====
CHECK PASS 1st (email one): actual=true expected=true
CHECK PASS 2nd (new id, same email after trim+lowercase): actual=false expected=false
CHECK PASS 3rd (email two): actual=true expected=true
# Scenario N — raw proof, run=1791062315582 (started 2026-10-03T21:18:35.703Z)
==== N setup: maxRedemptions 5, 4 sequential uses ====
CHECK PASS uses before race: actual=4 expected=4
==== N race: 10 parallel POST /conversions ====
CHECK PASS all 10 sales recorded (HTTP 201): actual=[201,201,201,201,201,201,201,201,201,201] expected=[201,201,201,201,201,201,201,201,201,201]
CHECK PASS exactly one applied: actual=1 expected=1
CHECK PASS uses after race (never above 5): actual=5 expected=5
```

N: 4 uses recorded, then 10 sales at once with the same coupon (limit 5): all 10 sales recorded (201), exactly one got the coupon, uses = 5 in SQL (`organization_coupon_usage` row lock).

### 3.3 Start/end date boundaries (P)

Org A = Asia/Kolkata (UTC+05:30), Org B = UTC. Coupon valid `2026-09-01` → `2026-09-05` (date-only, org timezone).

| org | case | occurredAt (UTC) | expected | actual |
|---|---|---|---|---|
| A | just before start (IST 2026-08-31 23:59:59.999) | 2026-08-31T18:29:59.999Z | refused | refused |
| A | exactly at start (IST 2026-09-01 00:00:00.000) | 2026-08-31T18:30:00.000Z | counts | counts |
| A | UTC midnight Sep 1 (IST 05:30) inside | 2026-09-01T00:00:00.000Z | counts | counts |
| A | just before end (IST 2026-09-05 23:59:59.998) | 2026-09-05T18:29:59.998Z | counts | counts |
| A | exactly at end (IST 2026-09-05 23:59:59.999) | 2026-09-05T18:29:59.999Z | counts | counts |
| A | just after end (IST 2026-09-06 00:00:00.000) | 2026-09-05T18:30:00.000Z | refused | refused |
| A | UTC 2026-09-05 23:00 (= IST Sep 6 04:30) outside | 2026-09-05T23:00:00.000Z | refused | refused |
| B | UTC org: just before start | 2026-08-31T23:59:59.999Z | refused | refused |
| B | UTC org: exactly at start | 2026-09-01T00:00:00.000Z | counts | counts |
| B | UTC org: exactly at end | 2026-09-05T23:59:59.999Z | counts | counts |
| B | UTC org: just after end | 2026-09-06T00:00:00.000Z | refused | refused |

### 3.4 Permissions (V)

Role × API matrix (expected from the permission catalog; actual HTTP status). UI: VIEWER and NOPERM see no
create/edit/assign/pause/archive controls (V2, screenshots in proof).

| role | API | expected | actual |
|---|---|---|---|
| ORG_A_OWNER | GET list | 200 | 200 |
| ORG_A_OWNER | GET get | 200 | 200 |
| ORG_A_OWNER | GET settings get | 200 | 200 |
| ORG_A_OWNER | GET overview | 200 | 200 |
| ORG_A_OWNER | GET performance | 200 | 200 |
| ORG_A_OWNER | GET by-affiliate | 200 | 200 |
| ORG_A_OWNER | GET by-program | 200 | 200 |
| ORG_A_OWNER | GET activity | 200 | 200 |
| ORG_A_OWNER | GET validate | 200 | 200 |
| ORG_A_OWNER | GET coupon analytics | 200 | 200 |
| ORG_A_OWNER | POST create | 201 | 201 |
| ORG_A_OWNER | PUT update | 200 | 200 |
| ORG_A_OWNER | POST pause | 201 | 201 |
| ORG_A_OWNER | POST assign | 201 | 201 |
| ORG_A_OWNER | DELETE unassign | 200 | 200 |
| ORG_A_OWNER | PUT settings put | 200 | 200 |
| ORG_A_OWNER | POST archive | 201 | 201 |
| ORG_A_MANAGER | GET list | 200 | 200 |
| ORG_A_MANAGER | GET get | 200 | 200 |
| ORG_A_MANAGER | GET settings get | 200 | 200 |
| ORG_A_MANAGER | GET overview | 200 | 200 |
| ORG_A_MANAGER | GET performance | 200 | 200 |
| ORG_A_MANAGER | GET by-affiliate | 200 | 200 |
| ORG_A_MANAGER | GET by-program | 200 | 200 |
| ORG_A_MANAGER | GET activity | 200 | 200 |
| ORG_A_MANAGER | GET validate | 200 | 200 |
| ORG_A_MANAGER | GET coupon analytics | 200 | 200 |
| ORG_A_MANAGER | POST create | 201 | 201 |
| ORG_A_MANAGER | PUT update | 200 | 200 |
| ORG_A_MANAGER | POST pause | 201 | 201 |
| ORG_A_MANAGER | POST assign | 201 | 201 |
| ORG_A_MANAGER | DELETE unassign | 200 | 200 |
| ORG_A_MANAGER | PUT settings put | 403 | 403 |
| ORG_A_MANAGER | POST archive | 403 | 403 |
| ORG_A_VIEWER | GET list | 200 | 200 |
| ORG_A_VIEWER | GET get | 200 | 200 |
| ORG_A_VIEWER | GET settings get | 200 | 200 |
| ORG_A_VIEWER | GET overview | 200 | 200 |
| ORG_A_VIEWER | GET performance | 200 | 200 |
| ORG_A_VIEWER | GET by-affiliate | 200 | 200 |
| ORG_A_VIEWER | GET by-program | 200 | 200 |
| ORG_A_VIEWER | GET activity | 200 | 200 |
| ORG_A_VIEWER | GET validate | 200 | 200 |
| ORG_A_VIEWER | GET coupon analytics | 200 | 200 |
| ORG_A_VIEWER | POST create | 403 | 403 |
| ORG_A_VIEWER | PUT update | 403 | 403 |
| ORG_A_VIEWER | POST pause | 403 | 403 |
| ORG_A_VIEWER | POST assign | 403 | 403 |
| ORG_A_VIEWER | DELETE unassign | 403 | 403 |
| ORG_A_VIEWER | PUT settings put | 403 | 403 |
| ORG_A_VIEWER | POST archive | 403 | 403 |
| ORG_A_NOPERM | GET list | 403 | 403 |
| ORG_A_NOPERM | GET get | 403 | 403 |
| ORG_A_NOPERM | GET settings get | 403 | 403 |
| ORG_A_NOPERM | GET overview | 403 | 403 |
| ORG_A_NOPERM | GET performance | 403 | 403 |
| ORG_A_NOPERM | GET by-affiliate | 403 | 403 |
| ORG_A_NOPERM | GET by-program | 403 | 403 |
| ORG_A_NOPERM | GET activity | 403 | 403 |
| ORG_A_NOPERM | GET validate | 403 | 403 |
| ORG_A_NOPERM | GET coupon analytics | 403 | 403 |
| ORG_A_NOPERM | POST create | 403 | 403 |
| ORG_A_NOPERM | PUT update | 403 | 403 |
| ORG_A_NOPERM | POST pause | 403 | 403 |
| ORG_A_NOPERM | POST assign | 403 | 403 |
| ORG_A_NOPERM | DELETE unassign | 403 | 403 |
| ORG_A_NOPERM | PUT settings put | 403 | 403 |
| ORG_A_NOPERM | POST archive | 403 | 403 |

---------------------------------------------------------------------------------------------------------------------
## 4. Bugs (money first)

Severity: Critical = money paid/counted wrongly or lost; High = data integrity / wrong success; Medium = wrong
behaviour or data shown; Low = UX. BE = partner-iq-backend, FE = partner-iq-frontend, AP = partner-iq-affiliate-portal.

| # | Sev | Bug | Cause | Impact | Commit | Proof |
|---|---|---|---|---|---|---|
| 1 | Critical (money) | Coupons ignored when a sale is recorded: limits, status, dates never enforced; coupon affiliate never credited; `couponAttributionPriority` never read | `ConversionsService` stored `metadata.couponCode` as opaque data; no coupon logic at sale time | unlimited discounts, wrong affiliate paid, "Promo Code Wins" ignored | BE 52aa339 (+ tables b2bf59f) | I, K, M, N, P |
| 2 | Critical (money) | A new affiliate's EARNED ledger balance never persisted | `LedgerService.getAccount` mutated the plain object, not the stored proxy | payouts saw ₹0; balances lost on restart | BE 1c47bb3 | Q2 |
| 3 | Critical (audit-introduced, test DB only) | Changing the `discountValue` column type made `synchronize: true` drop and re-add the column, wiping 50,005 values | TypeORM schema sync runs before migrations and recreates changed columns | data loss in the audit DB (restored from known fixture definitions); design changed to a new `discountValueExact` column | BE 98fc200 | `incident-discountValue-sync.txt` |
| 4 | High (money) | Discount KPIs recomputed from the coupon's current value and treated paid amounts as gross; editing a coupon rewrote history | no per-sale discount stored | wrong discount/revenue KPIs | BE 4f96bd9 (+b2bf59f) | B, H3, L |
| 5 | High (money) | 100 %-off and fixed > price orders could not be recorded (`amount ≥ 1`) | DTO `Min(1)` | such uses never counted, limits bypassed | BE 52aa339 | L FREE / FIXBIG |
| 6 | High | API returned 201/200 while the MySQL write was blocked (create, edit, on/off switch) | memory-first writes, background persistence | success reported for data that may never be stored | BE 4f96bd9, 015730a | Y, Y2 |
| 7 | High | 4xx left coupons/edits behind (create with a bad affiliate, edit end < start) | writes before validation | half-created coupons | BE 4f96bd9 | H2, W, X |
| 8 | High | Code rules: >60 chars memory-only, `% ' space emoji Cyrillic` accepted, case kept, duplicate = 400 not 409, race created duplicates | DTO + memory-only uniqueness check | unusable/duplicate codes | BE 4f96bd9 | E, F |
| 9 | Medium (money) | KPI cards rounded money (₹157.50 shown as ₹158) | formatter without decimals | admins see wrong totals | FE 157ad54 | B |
| 10 | Medium | Org timezone ignored; UI sent UTC midnight (end day excluded) | UTC instants | coupons expired 5.5 h early (IST) | BE 4f96bd9, FE 157ad54 | D, P |
| 11 | Medium | By-affiliate history followed the current assignment | analytics joined current assignments | moving a coupon moved past sales | BE 4f96bd9 | J1 |
| 12 | Medium | Code-check unthrottled; response listed affiliate emails | no `@Throttle`, full assignment view | enumeration, data leak | BE 4f96bd9 | S, U |
| 13 | Medium | Archived coupons could be reactivated/edited; archive needed only `coupons.edit` | no terminal state | "deleted" coupons revived | BE 4f96bd9 | I3, V |
| 14 | Medium | Audit rows without before/after values | metadata = field names only | no change history | BE 4f96bd9 | AD |
| 15 | Medium | Detail drawer showed a fabricated `customer@partneriq.in` | backend fallback string | fake data shown to admins | BE 4f96bd9, FE 157ad54 | L |
| 16 | Medium | Portal: Uses/Sales/Earned always 0, `$` currency, "Active" for expired coupons | hard-coded zeros, `$` | affiliates misinformed | AP 53eee6e (+ BE fields 4f96bd9) | R |
| 17 | Medium | Owner/Admin could not see Create/Edit; VIEWER saw every control; ANALYST got a page of 403s | role map did not match backend permissions | admins blocked; others offered actions that fail | FE 6813153, 157ad54 | V |
| 18 | Medium | CSV export: formula injection, JSON blobs, no BOM | shared DataTable export | spreadsheet formula execution | FE 7cbdd99, 157ad54 | Z |
| 19 | Medium (audit-introduced, fixed before push) | Migration `down()` partially reverted when it refused | checks interleaved with drops | half-reverted schema | BE b2bf59f | `migration-roundtrip.txt` |
| 20 | Medium (audit-introduced, fixed before push) | Concurrent uses deadlocked → 503 | `INSERT IGNORE` shared lock | sales refused under load | BE 52aa339 | N |
| 21 | Low | Load errors shown as zeros; fast filter changes showed stale results | no error state; no response sequencing | misleading KPIs | FE 157ad54 | AB |
| 22 | Low | Table affiliate filter ignored | filter not applied to table | wrong rows | FE 157ad54 | C2 |
| 23 | Low | Generator could propose an existing code | no check against existing codes | 409 on save | FE 157ad54 | G |
| 24 | Low | Coupon settings requested twice per page load | layout + page both fetch | duplicate requests | FE 157ad54, 8cb16bb | A |
| 25 | Low | Detail drawer did not close on X or Escape; dialogs kept old input | shared SheetClose without handler | UX | FE 157ad54 | AA |
| 26 | Low | Failed coupon-assignment email silently discarded | `.catch(() => undefined)` | operators never see failed notifications | BE 82c3e9c | code review |

`git show --stat` for every audit commit (the final report commit itself is excluded):

### partner-iq-backend 57d7a7a audit(coupons): add e2e Playwright workspace and progress log
```
 docs/coupons-progress.md |  29 +++++++
 e2e/package-lock.json    | 221 +++++++++++++++++++++++++++++++++++++++++++++++
 e2e/package.json         |  11 +++
 3 files changed, 261 insertions(+)
```
### partner-iq-backend b123b12 audit(coupons): Phase 1 inventory, decisions log, user decisions
```
 docs/coupons-inventory.md | 216 ++++++++++++++++++++++++++++++++++++++++++++++
 docs/coupons-progress.md  |  39 +++++++++
 docs/decisions.md         |   8 ++
 3 files changed, 263 insertions(+)
```
### partner-iq-backend c5cf728 audit(coupons): Phase 2 fixtures + scenario specs A–AF (failing baseline before fixes)
```
 docs/coupons-phase2-fixtures.md            |  84 +++++
 docs/coupons-proof/baseline/A.txt          |  33 ++
 docs/coupons-proof/baseline/AA.txt         |   2 +
 docs/coupons-proof/baseline/AB.txt         |  29 ++
 docs/coupons-proof/baseline/AC.txt         |   4 +
 docs/coupons-proof/baseline/AD.txt         |  10 +
 docs/coupons-proof/baseline/AE.txt         |  29 ++
 docs/coupons-proof/baseline/B.txt          |   3 +
 docs/coupons-proof/baseline/C.txt          |   1 +
 docs/coupons-proof/baseline/D.txt          |   1 +
 docs/coupons-proof/baseline/E.txt          |   8 +
 docs/coupons-proof/baseline/F.txt          |   1 +
 docs/coupons-proof/baseline/G.txt          |  11 +
 docs/coupons-proof/baseline/H.txt          |   1 +
 docs/coupons-proof/baseline/I.txt          |  50 +++
 docs/coupons-proof/baseline/J.txt          |   1 +
 docs/coupons-proof/baseline/K.txt          |  23 ++
 docs/coupons-proof/baseline/L.txt          |  21 ++
 docs/coupons-proof/baseline/M.txt          |   7 +
 docs/coupons-proof/baseline/N.txt          |   8 +
 docs/coupons-proof/baseline/O.txt          |  43 +++
 docs/coupons-proof/baseline/P.txt          | 171 ++++++++++
 docs/coupons-proof/baseline/Q.txt          |  52 +++
 docs/coupons-proof/baseline/R.txt          |  87 +++++
 docs/coupons-proof/baseline/S.txt          |  43 +++
 docs/coupons-proof/baseline/T.txt          |  65 ++++
 docs/coupons-proof/baseline/U.txt          |   4 +
 docs/coupons-proof/baseline/V.txt          | 306 +++++++++++++++++
 docs/coupons-proof/baseline/W.txt          | 363 ++++++++++++++++++++
 docs/coupons-proof/baseline/X.txt          |  32 ++
 docs/coupons-proof/baseline/Y.txt          |  21 ++
 docs/coupons-proof/baseline/Z.txt          |   1 +
 docs/coupons-proof/baseline/_cleanup.txt   |   3 +
 docs/coupons-proof/baseline/_test-runs.txt | 214 ++++++++++++
 e2e/.gitignore                             |   5 +
 e2e/coupons/A-page-load.spec.ts            |  50 +++
 e2e/coupons/AA-cancel-close.spec.ts        |  99 ++++++
 e2e/coupons/AB-errors.spec.ts              |  71 ++++
 e2e/coupons/AC-empty-org.spec.ts           |  50 +++
 e2e/coupons/AD-audit.spec.ts               |  46 +++
 e2e/coupons/AE-large-data.spec.ts          | 124 +++++++
 e2e/coupons/B-kpis.spec.ts                 | 119 +++++++
 e2e/coupons/C-table.spec.ts                | 177 ++++++++++
 e2e/coupons/D-create-ui.spec.ts            |  79 +++++
 e2e/coupons/E-code-rules.spec.ts           | 136 ++++++++
 e2e/coupons/F-race.spec.ts                 |  42 +++
 e2e/coupons/G-generator.spec.ts            |  61 ++++
 e2e/coupons/H-edit.spec.ts                 | 122 +++++++
 e2e/coupons/I-off-expire-delete.spec.ts    |  75 +++++
 e2e/coupons/J-move.spec.ts                 |  74 ++++
 e2e/coupons/K-credit.spec.ts               |  98 ++++++
 e2e/coupons/L-math.spec.ts                 |  67 ++++
 e2e/coupons/M-limits.spec.ts               |  99 ++++++
 e2e/coupons/N-last-use-race.spec.ts        |  43 +++
 e2e/coupons/O-duplicate-sale.spec.ts       |  56 ++++
 e2e/coupons/P-dates.spec.ts                |  58 ++++
 e2e/coupons/Q-refunds.spec.ts              |  91 +++++
 e2e/coupons/R-portal.spec.ts               | 114 +++++++
 e2e/coupons/S-validate.spec.ts             |  59 ++++
 e2e/coupons/T-integrations.spec.ts         |  79 +++++
 e2e/coupons/U-isolation.spec.ts            |  64 ++++
 e2e/coupons/V-permissions.spec.ts          | 102 ++++++
 e2e/coupons/W-bad-input.spec.ts            | 115 +++++++
 e2e/coupons/X-no-leftovers.spec.ts         |  67 ++++
 e2e/coupons/Y-db-failure.spec.ts           |  77 +++++
 e2e/coupons/Z-export.spec.ts               |  77 +++++
 e2e/global-setup.ts                        |   5 +
 e2e/global-teardown.ts                     |  26 ++
 e2e/lib/actors.ts                          |  88 +++++
 e2e/lib/api.ts                             |  63 ++++
 e2e/lib/coupons.ts                         | 115 +++++++
 e2e/lib/db.ts                              |  31 ++
 e2e/lib/env.ts                             |  35 ++
 e2e/lib/fixtures.ts                        |  30 ++
 e2e/lib/proof.ts                           |  54 +++
 e2e/lib/sales.ts                           |  47 +++
 e2e/lib/session.ts                         |  15 +
 e2e/lib/ui.ts                              |  63 ++++
 e2e/package-lock.json                      | 521 ++++++++++++++++++++++++++++-
 e2e/package.json                           |   7 +-
 e2e/playwright.config.ts                   |  17 +
 e2e/scripts/cleanup.ts                     |  41 +++
 e2e/scripts/restart-backend.sh             |  16 +
 e2e/scripts/run-suite.sh                   |   6 +
 e2e/scripts/seed-fixtures.ts               | 131 ++++++++
 85 files changed, 5636 insertions(+), 3 deletions(-)
```
### partner-iq-backend b2bf59f fix(coupons): coupon use ledger tables, decimal discounts, per-customer limit (reversible migration)
```
 docs/coupons-proof/migration-roundtrip.txt         |  14 ++
 e2e/scripts/migration-roundtrip.ts                 |  51 ++++++
 src/database/data-source.ts                        |   4 +
 .../2026100300000_CouponRedemptionLedger.ts        | 184 +++++++++++++++++++++
 src/database/schema.ts                             | 118 ++++++++++++-
 5 files changed, 370 insertions(+), 1 deletion(-)
```
### partner-iq-backend e2188a2 test(coupons): make K3, Q2, O, T, J1, U independent of earlier runs
```
 e2e/coupons/J-move.spec.ts           | 26 ++++++++++++++----------
 e2e/coupons/K-credit.spec.ts         | 38 ++++++++++++++++++++++--------------
 e2e/coupons/O-duplicate-sale.spec.ts |  5 +++--
 e2e/coupons/Q-refunds.spec.ts        | 26 ++++++++++++++----------
 e2e/coupons/T-integrations.spec.ts   |  7 ++++---
 e2e/coupons/U-isolation.spec.ts      |  7 +++++--
 e2e/lib/coupons.ts                   |  2 ++
 7 files changed, 69 insertions(+), 42 deletions(-)
```
### partner-iq-backend 1c47bb3 fix(ledger): persist a new affiliate's EARNED balance
```
 src/modules/ledger/ledger.service.ts | 5 +++++
 1 file changed, 5 insertions(+)
```
### partner-iq-backend 4f96bd9 fix(coupons): validate before writing, MySQL-first writes, code/date rules, analytics from recorded uses
```
 .../affiliate-coupons.controller.ts                |   18 +-
 src/modules/coupons/coupon-rules.ts                |  197 ++++
 src/modules/coupons/coupons.controller.ts          |   21 +-
 src/modules/coupons/coupons.service.ts             | 1081 +++++++++++---------
 src/modules/coupons/dto/coupon.dto.ts              |  142 ++-
 5 files changed, 934 insertions(+), 525 deletions(-)
```
### partner-iq-backend 52aa339 fix(coupons): apply coupons when a sale is recorded (credit, limits, dates, refunds)
```
 src/modules/conversions/conversions.module.ts    |   3 +-
 src/modules/conversions/conversions.service.ts   | 299 ++++++++++++++---------
 src/modules/conversions/dto/conversion.dto.ts    |  12 +-
 src/modules/coupons/coupon-redemption.module.ts  |   9 +
 src/modules/coupons/coupon-redemption.service.ts | 248 +++++++++++++++++++
 5 files changed, 455 insertions(+), 116 deletions(-)
```
### partner-iq-backend 98fc200 fix(coupons): never change the discountValue column type (schema sync wiped values)
```
 docs/coupons-proof/incident-discountValue-sync.txt | 32 ++++++++++++++++++++++
 docs/coupons-proof/migration-roundtrip.txt         | 20 ++++++--------
 e2e/scripts/migration-roundtrip.ts                 | 10 +++++--
 .../2026100300000_CouponRedemptionLedger.ts        | 20 ++++++++------
 src/database/schema.ts                             | 23 +++++++++++++---
 src/modules/coupons/coupons.service.ts             | 13 +++++----
 6 files changed, 84 insertions(+), 34 deletions(-)
```
### partner-iq-backend 03cfd1d test(coupons): billing boundary spec (S4), stabilise UI specs against the preview build
```
 e2e/coupons/AA-cancel-close.spec.ts     |  2 +-
 e2e/coupons/B-kpis.spec.ts              |  2 +-
 e2e/coupons/D-create-ui.spec.ts         |  8 ++--
 e2e/coupons/I-off-expire-delete.spec.ts |  5 +++
 e2e/coupons/M-limits.spec.ts            |  8 ++--
 e2e/coupons/S-billing-boundary.spec.ts  | 78 +++++++++++++++++++++++++++++++++
 e2e/coupons/V-permissions.spec.ts       |  4 ++
 e2e/lib/ui.ts                           |  2 +
 e2e/scripts/repair-fixture-coupons.ts   | 53 ++++++++++++++++++++++
 9 files changed, 154 insertions(+), 8 deletions(-)
```
### partner-iq-backend 015730a fix(coupons): coupons on/off switch is saved to MySQL before it is reported
```
 e2e/coupons/Y-db-failure.spec.ts       | 29 +++++++++++++++++++++++++++++
 src/modules/coupons/coupons.service.ts | 24 +++++++++++++++++-------
 2 files changed, 46 insertions(+), 7 deletions(-)
```
### partner-iq-backend ab3cc67 test(coupons): survive the admin auth refresh race on page load (logged, not hidden)
```
 docs/coupons-proof/auth-reload-race.txt | 11 +++++++++
 e2e/coupons/D-create-ui.spec.ts         |  4 ++--
 e2e/coupons/M-limits.spec.ts            |  8 ++++---
 e2e/lib/ui.ts                           | 42 ++++++++++++++++++++++++++++++++-
 4 files changed, 59 insertions(+), 6 deletions(-)
```
### partner-iq-backend 82c3e9c fix(coupons): log failed coupon-assignment emails; decisions D11b–D25
```
 docs/decisions.md                      | 59 ++++++++++++++++++++++++++++++++--
 src/modules/coupons/coupons.service.ts |  3 +-
 2 files changed, 58 insertions(+), 4 deletions(-)
```
### partner-iq-frontend 7cbdd99 fix(data-table): neutralise spreadsheet formulas in CSV export; per-column export values
```
 src/components/ui/data-table.tsx | 38 ++++++++++++++++++++++++++++----------
 1 file changed, 28 insertions(+), 10 deletions(-)
```
### partner-iq-frontend 6813153 fix(coupons): derive coupon UI permissions from the member's role
```
 src/lib/auth/coupon-permissions.test.ts | 20 ++++++++++++++++
 src/lib/auth/role-access.ts             | 41 ++++++++++++++++++++++++++++++++-
 2 files changed, 60 insertions(+), 1 deletion(-)
```
### partner-iq-frontend 157ad54 fix(coupons): admin coupon screens match the backend rules
```
 .../coupons/coupons-affiliates-section.tsx         |  19 ++--
 .../coupons/coupons-analytics-section.tsx          |  10 +-
 src/components/coupons/coupons-bento-overview.tsx  |  26 +++--
 src/components/coupons/coupons-charts-section.tsx  |   6 +-
 src/components/coupons/coupons-header.tsx          |   5 +-
 .../coupons/coupons-performance-section.tsx        |  14 +--
 .../coupons/coupons-programs-section.tsx           |   6 +-
 src/components/coupons/coupons-table-section.tsx   | 108 ++++++++++++++-------
 .../coupons/dialogs/assign-affiliates-dialog.tsx   |  11 ++-
 .../coupons/dialogs/coupon-detail-sheet.tsx        |  37 ++++---
 .../coupons/dialogs/coupon-form-dialog.tsx         |  71 ++++++++++----
 .../coupons/dialogs/validate-coupon-dialog.tsx     |   9 +-
 src/components/pages/coupons-view.tsx              | 102 +++++++++++++------
 src/lib/api/coupons.ts                             |  54 +++++++++--
 14 files changed, 339 insertions(+), 139 deletions(-)
```
### partner-iq-frontend 8cb16bb fix(coupons): one coupon-settings request per page load
```
 src/lib/api/coupons.ts | 5 +++--
 1 file changed, 3 insertions(+), 2 deletions(-)
```
### partner-iq-affiliate-portal 53eee6e fix(coupons): show real use counts and earnings in the affiliate coupon screen
```
 src/components/views/CouponsView.tsx | 10 +++++++---
 src/lib/api/coupons.ts               | 31 ++++++++++++++++++++++---------
 2 files changed, 29 insertions(+), 12 deletions(-)
```

---------------------------------------------------------------------------------------------------------------------
## 5. In-memory store risks for coupons (X, Y) — `src/database/store.ts` not edited

1. **Success before persistence.** `DBBackedArray.push` and Proxy property sets start background upserts whose errors
   are only `console.error`'d (`store.ts:469-471, 517-519`). Coupon writes now go to MySQL first (Y, Y2: 503 and
   nothing saved while the table is locked), but **audit rows, conversions and commissions are still memory-first**: a
   failed write returns 2xx and memory and MySQL disagree until restart.
2. **Lost updates.** Each property assignment upserts the whole row in the background; two updates can land out of
   order. Seen in this audit: conversion `APPROVED` in memory while MySQL kept `PENDING`
   (`docs/coupons-proof/L.txt`, `SELECT … status FROM conversions`). Coupon analytics read conversion status from MySQL,
   so they can disagree with screens that read memory.
3. **Boot limit.** `super(...items.map())` in the `DBBackedArray` constructor overflows the stack above ~62,000 rows in
   any one table (Node 22): the backend cannot start with 200,000 conversions (AE baseline proof). **BLOCKED** for the
   200,000-use AE target (D17).
4. **Swallowed load errors.** The store's load block is wrapped in `try {} catch {}`; 8 unregistered job entities
   make it throw, so `dbStore.organizationSettings` is always empty after a restart (the org timezone is therefore
   read from MySQL, D10b).
5. **`synchronize: true` at boot** (data-source.ts) recreates changed columns before migrations run — caused bug #3 in
   the audit DB. In production this would destroy data on any column type change.
6. **No DB unique key on `conversions.externalId`.** Duplicate sales are stopped in memory (plus a static in-flight
   set added in this audit); several backend instances could still record the same order twice. Coupon uses are
   protected by MySQL unique keys (`UQ_coupon_redemption_order`), so a coupon is never counted twice (O).
7. The prompt's "`throw err` inside background `.catch` handlers" is **not present** in this checkout
   (`grep -n "throw err" src/database/store.ts` → no match); the risk here is the opposite (silent swallow).
8. Large tables: 50,000 coupons + 55,000 uses add ~49 MB RSS and the boot takes ~6 s (AE).

---------------------------------------------------------------------------------------------------------------------
## 6. Decisions you need to make (review first)

All decisions taken are in `docs/decisions.md`. These need your confirmation:

1. **Money — commission base (D5):** `amount` sent to `POST /conversions` is now the paid amount after discount. Any
   merchant integration that sends the pre-discount price will over-report revenue and commission. Confirm the SDK
   docs/integrations send the paid amount.
2. **Money — coupon beats link (D4):** the existing per-program `couponAttributionPriority` decides (default "Promo
   Code Wins"), not a new per-org setting. Confirm per-program is acceptable.
3. **Money — refused coupon does not block the sale (D7):** the sale is recorded without coupon credit and the API
   says `coupon.applied=false, reason=…`. The merchant may still have given the customer the discount.
4. **Money — negative balances (D11):** refunds after payout carry a negative EARNED balance (shown in the "Balance"
   column). No write-off policy exists.
5. **UI text changed (D25):** "All Affiliates" → "Unassigned"; fabricated customer email → "Customer email not
   reported"; portal expired coupon → "Expired — do not share". The prompt said not to remove UI text without asking;
   the later standing instruction said decide. Revert if you disagree.
6. **Auth refresh race (D22, not fixed):** ~15 % of admin page loads log the user out (two concurrent `/auth/refresh`
   calls). Shared auth code, outside coupon scope.
7. **Store risks (§5):** whether to move conversions/commissions/audit writes to MySQL-first, fix the 62k boot limit
   and turn off `synchronize` in production.
8. **Code-check reasons (D13):** the default rule says missing/expired/inactive should look the same. The only
   code-check endpoint is the admin "Validate Code" tool (JWT + `coupons.view`, same user can list every coupon), so it
   keeps specific reasons ("expired on…", "paused"). No public checkout code-check exists. If you add one, it must
   return one generic answer.
9. **Shared DataTable change (D15):** CSV formula neutralisation affects every table in the admin app.

---------------------------------------------------------------------------------------------------------------------
## 7. Not tested, and why

| Item | Why |
|---|---|
| AE with 200,000 uses | **BLOCKED**: backend cannot boot with > ~62,000 rows in one `dbStore` table (store.ts, not editable here). Measured with 50,000 coupons + 55,000 uses (D17). |
| T3 signed webhook from a *connected* Razorpay/Cashfree account | **BLOCKED**: no provider credentials. Unsigned/badly signed webhooks are refused (tested). These webhooks carry no coupon field (R15). |
| Several backend instances at once | single process in this environment; MySQL locks/unique keys are designed for it but only one instance was run. |
| Node 24 | environment has Node 22.22.0. |
| Real email delivery | dev email provider (logs only); the assignment email content was not asserted. |
| Bulk coupon import (G) | no import feature exists (inventory §1). |
| Billing coupon behaviour itself | out of scope (decision 2); only the boundary (§9). |
| Mobile layouts, accessibility, browsers other than Chromium | not requested. |
| Production data / migration on a production-sized DB | test DB only; migration round-trip proven on the audit DB (`migration-roundtrip.txt`). |
| Backend `npm ci` with the committed lockfile | lockfile out of sync and `cdn.sheetjs.com` blocked by the network policy; xlsx installed temporarily from npm, manifests not committed. |

---------------------------------------------------------------------------------------------------------------------
## 8. Affiliate portal contract (user decision 1)

Fields the portal reads from `GET /api/v1/affiliate/me/assigned-coupons` (`partner-iq-affiliate-portal/src/lib/api/coupons.ts`):
`id`, `organizationId`, `code`, `description`, `discountType`, `discountValue`, `validUntil` (unchanged), plus the new
`status`, `uses`, `conversions`, `revenueGenerated`, `commissionEarned`, `currency`. Fields were only added; no route,
request or existing field changed. Security (R, U): an affiliate gets only coupons assigned to them in ACTIVE
status; tampered organization ids, other affiliates' tokens and other orgs' codes return nothing of anyone else's; no
`maxRedemptions`, assignments, emails or other affiliates appear in the response.

---------------------------------------------------------------------------------------------------------------------
## 9. Billing-coupon boundary (user decision 2, report only — no billing code changed)

- Shared tables: none (`organization_coupon*` vs `billing_coupon*`); shared generic tables `audit_logs` and the
  permission catalog (`coupons.*` vs `billing.coupons.*`).
- Shared services/validation: none (no imports either way). `normalizeCode` exists separately in
  `billing-coupon-validation.service.ts` and `coupon-rules.ts`.
- Code-check endpoints: org `GET /organizations/:id/coupons/validate/:code`; billing
  `POST /organizations/:id/billing/coupons/validate`.
- Shared code paths for the billing audit: `audit_logs` writes via `dbStore`, `PermissionsGuard`/permission catalog,
  `OrganizationGuard`, the global throttler.

Both directions tested (`coupons-proof/S-billing.txt`; a billing coupon was inserted directly in MySQL as test data and deleted afterwards):

```
mysql> SELECT id, code, status FROM billing_coupons WHERE id='b1d86630-c335-4b5c-ac31-717be639c9f7' (inserted directly as test data)
==== S4a positive control: the billing coupon is valid at billing checkout ====
> POST /organizations/eb2b08d5-22c4-4dd7-a225-37421c48f27e/billing/coupons/validate
> body: {"planId":"6db5f5ca-7f41-4c1b-84dc-23e4f1680ca3","billingInterval":"MONTHLY","couponCode":"E2E-CPN-MUSQ2MAX-SB-BILL"}
< HTTP 201 (45 ms)
==== S4b organization coupon code at billing checkout ====
> POST /organizations/eb2b08d5-22c4-4dd7-a225-37421c48f27e/billing/coupons/validate
> body: {"planId":"6db5f5ca-7f41-4c1b-84dc-23e4f1680ca3","billingInterval":"MONTHLY","couponCode":"E2E-CPN-MUSQ2MAX-PCT10"}
< HTTP 201 (38 ms)
CHECK PASS control: billing quote valid: actual=true expected=true
CHECK PASS org coupon code: billing quote valid: actual=false expected=false
CHECK PASS control: billing coupon gives a discount: actual=true expected=true
CHECK PASS org coupon code gives no billing discount: actual=0 expected=0
==== S4c billing coupon code on an affiliate sale (POST /conversions) ====
> POST /conversions
> body: {"externalId":"e2e-cpn-1791051925353-SB-sale-1791062568092","metadata":{"couponCode":"E2E-CPN-MUSQ2MAX-SB-BILL"}}
< HTTP 201 (61 ms)
mysql> SELECT id FROM organization_coupon_redemptions JOIN conversions WHERE externalId='e2e-cpn-1791051925353-SB-sale-1791062568092'
CHECK PASS billing code on a sale: coupon.applied: actual=false expected=false
CHECK PASS billing code on a sale: reason: actual="NOT_FOUND" expected="NOT_FOUND"
CHECK PASS no organization-coupon use recorded: actual=0 expected=0
```

---------------------------------------------------------------------------------------------------------------------
## 10. Test runs (raw output)

Raw outputs are saved in `docs/coupons-proof/test-runs/` (ANSI colours stripped). Pre-existing failures were re-run
on `main` (git worktree, same database, same `.env.test`) and fail identically there (`test-runs/main/`).

### 10.1 Coupon suite (Playwright, all scenarios incl. AE) — 126 passed, 0 failed

```
Running 126 tests using 1 worker

  ✓    1 coupons/A-page-load.spec.ts:13:7 › A page load as ORG_A_OWNER (8.5s)
  ✓    2 coupons/A-page-load.spec.ts:13:7 › A page load as ORG_A_VIEWER (8.5s)
  ✓    3 coupons/AA-cancel-close.spec.ts:26:5 › AA1 create/edit form dialog (12.7s)
  ✓    4 coupons/AA-cancel-close.spec.ts:64:5 › AA2 detail drawer, assign dialog, validate dialog (13.0s)
  ✓    5 coupons/AB-errors.spec.ts:23:7 › AB1 all coupon APIs fail with 500 (7.7s)
  ✓    6 coupons/AB-errors.spec.ts:23:7 › AB1 all coupon APIs fail with 403 (7.6s)
  ✓    7 coupons/AB-errors.spec.ts:23:7 › AB1 all coupon APIs fail with network (7.6s)
  ✓    8 coupons/AB-errors.spec.ts:23:7 › AB1 all coupon APIs fail with broken JSON (6.2s)
  ✓    9 coupons/AB-errors.spec.ts:42:5 › AB2 3 s delay + rapid filter changes end on the last filter (9.5s)
  ✓   10 coupons/AC-empty-org.spec.ts:16:5 › AC empty organization (3.8s)
  ✓   11 coupons/AD-audit.spec.ts:15:5 › AD audit rows (506ms)
Terminated

  ✓   12 coupons/AE-large-data.spec.ts:24:5 › AE large data timings and memory (29.1s)
  ✓   13 coupons/B-kpis.spec.ts:83:7 › B API 7D, all affiliates (44ms)
  ✓   14 coupons/B-kpis.spec.ts:83:7 › B API LIFETIME, all affiliates (28ms)
  ✓   15 coupons/B-kpis.spec.ts:83:7 › B API 7D, affiliate B1 (31ms)
  ✓   16 coupons/B-kpis.spec.ts:83:7 › B API LIFETIME, program B1 (30ms)
  ✓   17 coupons/B-kpis.spec.ts:96:5 › B UI cards equal SQL for 30D and Lifetime (after refresh) (7.0s)
  ✓   18 coupons/C-table.spec.ts:52:5 › C1 five rows: every column against SQL (API + UI) (7.0s)
  ✓   19 coupons/C-table.spec.ts:87:5 › C2 search: exact, partial, case, special characters; affiliate filter (9.5s)
  ✓   20 coupons/C-table.spec.ts:124:5 › C3 status + discount filters and 3 combinations vs SQL (15.0s)
  ✓   21 coupons/C-table.spec.ts:146:5 › C4 sort both directions + first/partial/last page (7.0s)
  ✓   22 coupons/D-create-ui.spec.ts:22:7 › D create PERCENTAGE via UI (8.4s)
  ✓   23 coupons/D-create-ui.spec.ts:22:7 › D create FIXED_AMOUNT via UI (10.8s)
  ✓   24 coupons/E-code-rules.spec.ts:27:5 › E1 SHOW CREATE TABLE organization_coupons (5ms)
  ✓   25 coupons/E-code-rules.spec.ts:52:7 › E2 reject empty code (28ms)
  ✓   26 coupons/E-code-rules.spec.ts:52:7 › E2 reject whitespace only (29ms)
  ✓   27 coupons/E-code-rules.spec.ts:52:7 › E2 reject one character (34ms)
  ✓   28 coupons/E-code-rules.spec.ts:52:7 › E2 reject 41 characters (too long) (21ms)
  ✓   29 coupons/E-code-rules.spec.ts:52:7 › E2 reject 61 characters (over DB column) (22ms)
  ✓   30 coupons/E-code-rules.spec.ts:52:7 › E2 reject invalid characters % (21ms)
  ✓   31 coupons/E-code-rules.spec.ts:52:7 › E2 reject invalid characters quote (26ms)
  ✓   32 coupons/E-code-rules.spec.ts:52:7 › E2 reject inner space (26ms)
  ✓   33 coupons/E-code-rules.spec.ts:52:7 › E2 reject emoji (24ms)
  ✓   34 coupons/E-code-rules.spec.ts:52:7 › E2 reject leading hyphen (spreadsheet formula prefix) (25ms)
  ✓   35 coupons/E-code-rules.spec.ts:52:7 › E2 reject leading underscore (25ms)
  ✓   36 coupons/E-code-rules.spec.ts:52:7 › E2 reject Cyrillic А look-alike (25ms)
  ✓   37 coupons/E-code-rules.spec.ts:52:7 › E2 reject Greek Ο look-alike (24ms)
  ✓   38 coupons/E-code-rules.spec.ts:52:7 › E2 reject number instead of string (24ms)
  ✓   39 coupons/E-code-rules.spec.ts:74:5 › E3 trim + uppercase normalisation, then duplicates (same, other case, archived) (70ms)
  ✓   40 coupons/E-code-rules.spec.ts:113:5 › E4 same code allowed in another organization (26ms)
  ✓   41 coupons/E-code-rules.spec.ts:122:5 › E5 look-alike Latin codes (O vs 0, I vs l) are distinct codes and both accepted (52ms)
  ✓   42 coupons/F-race.spec.ts:18:7 › F identical code (99ms)
  ✓   43 coupons/F-race.spec.ts:18:7 › F case/space variants (94ms)
  ✓   44 coupons/G-generator.spec.ts:15:5 › G generator: 200 codes, alphabet, uniqueness, no clash with existing (19.1s)
  ✓   45 coupons/G-generator.spec.ts:39:5 › G generator never proposes an existing code (forced collision) (5.2s)
  ✓   46 coupons/H-edit.spec.ts:20:5 › H1 edit every editable field, verify API, SQL and GET after edit (358ms)
  ✓   47 coupons/H-edit.spec.ts:44:5 › H2 X: invalid edit (end before start) is rejected and changes NOTHING (339ms)
  ✓   48 coupons/H-edit.spec.ts:68:5 › H3 used coupon: code change, limit below usage, end date in past, discount change — past sales unchanged (340ms)
  ✓   49 coupons/I-off-expire-delete.spec.ts:21:7 › I1 seeded PAUSED coupon is refused when used (316ms)
  ✓   50 coupons/I-off-expire-delete.spec.ts:21:7 › I1 seeded ARCHIVED coupon is refused when used (301ms)
  ✓   51 coupons/I-off-expire-delete.spec.ts:21:7 › I1 seeded EXPIRED coupon is refused when used (307ms)
  ✓   52 coupons/I-off-expire-delete.spec.ts:39:5 › I2 pause → refused, reactivate → works again (691ms)
  ✓   53 coupons/I-off-expire-delete.spec.ts:55:5 › I3 delete a used coupon: no hard delete; archive keeps sales linked; code not reusable; archived cannot be reactivated (401ms)
  ✓   54 coupons/J-move.spec.ts:20:5 › J1 use under A1, move to A2, use again; analytics + both portals (1.7s)
  ✓   55 coupons/J-move.spec.ts:70:5 › J2 assign to an affiliate of another organization → 404, nothing assigned (31ms)
  ✓   56 coupons/K-credit.spec.ts:25:5 › K1 coupon sale with no click → coupon, affiliate and program linked; commission to coupon affiliate (353ms)
  ✓   57 coupons/K-credit.spec.ts:46:5 › K2 AFFILIATE_1 link clicked, AFFILIATE_2 coupon used → PROMO_CODE (default) credits AFFILIATE_2 (457ms)
  ✓   58 coupons/K-credit.spec.ts:61:5 › K3 program priority AFFILIATE ("Tracking Link Wins") → click affiliate credited, coupon still counted (473ms)
  ✓   59 coupons/K-credit.spec.ts:87:5 › K4 unassigned coupon, no click → coupon counted, nobody credited (no fallback affiliate) (329ms)
  ✓   60 coupons/K-credit.spec.ts:99:5 › K5 Org B coupon code sent with Org A key → not applied in Org A, Org B untouched (302ms)
  ✓   61 coupons/L-math.spec.ts:34:7 › L PCT10: PERCENTAGE 10 on ₹1000.00 (351ms)
  ✓   62 coupons/L-math.spec.ts:34:7 › L FIX200: FIXED_AMOUNT 200 on ₹1000.00 (379ms)
  ✓   63 coupons/L-math.spec.ts:34:7 › L ROUND: PERCENTAGE 12.5 on ₹999.99 (383ms)
  ✓   64 coupons/L-math.spec.ts:34:7 › L FIXBIG: FIXED_AMOUNT 1500 on ₹1000.00 (346ms)
  ✓   65 coupons/L-math.spec.ts:34:7 › L FREE: PERCENTAGE 100 on ₹499.00 (331ms)
  ✓   66 coupons/L-math.spec.ts:34:7 › L FIXDEC: FIXED_AMOUNT 99.5 on ₹250.00 (362ms)
  ✓   67 coupons/L-math.spec.ts:58:5 › L derived discount when merchant omits orderSubtotal (10 % coupon, paid ₹900.00) (351ms)
  ✓   68 coupons/M-limits.spec.ts:33:5 › M1 total limit N=3: 3 uses work, 4th refused; remaining matches SQL each step; UI after refresh (11.8s)
  ✓   69 coupons/M-limits.spec.ts:72:5 › M2 per-customer limit 1: same customer refused, different customer works (975ms)
  ✓   70 coupons/M-limits.spec.ts:91:5 › M3 per-customer limit also matches normalized email (guest checkouts with new customer IDs) (963ms)
  ✓   71 coupons/N-last-use-race.spec.ts:14:5 › N 10 concurrent uses with 1 left (1.1s)
  ✓   72 coupons/O-duplicate-sale.spec.ts:23:5 › O1 same order twice (sequential), with and without Idempotency-Key (580ms)
  ✓   73 coupons/O-duplicate-sale.spec.ts:45:5 › O2 same order 10 times at once (666ms)
  ✓   74 coupons/P-dates.spec.ts:36:5 › P boundaries in org timezone and UTC (3.4s)
  ✓   75 coupons/Q-refunds.spec.ts:28:5 › Q1 partial then full refund of a coupon sale (1.2s)
  ✓   76 coupons/Q-refunds.spec.ts:59:5 › Q2 refund after the commission was paid out → negative balance carried (1.4s)
  ✓   77 coupons/R-portal.spec.ts:24:5 › R1 own coupons only, safe fields only, numbers equal admin + SQL (1.1s)
  ✓   78 coupons/R-portal.spec.ts:65:5 › R2 tampering: other org id, admin routes with affiliate token, no write route (37ms)
  ✓   79 coupons/R-portal.spec.ts:92:5 › R3 portal UI shows own coupons with real numbers (after refresh) (4.4s)
  ✓   80 coupons/S-billing-boundary.spec.ts:26:5 › S4 org coupon code at SaaS billing checkout, and billing coupon code on an affiliate sale (6.5s)
  ✓   81 coupons/S-validate.spec.ts:18:5 › S1 responses for missing / expired / paused / valid codes (61ms)
  ✓   82 coupons/S-validate.spec.ts:31:5 › S2 other organizations / roles cannot probe Org A codes (391ms)
  ✓   83 coupons/S-validate.spec.ts:47:5 › S3 rapid guessing is rate limited (292ms)
  ✓   84 coupons/T-integrations.spec.ts:20:5 › T1 missing / malformed / revoked / wrong-org keys and cross-org coupon (210ms)
  ✓   85 coupons/T-integrations.spec.ts:49:5 › T2 replay of an old request (same externalId, same Idempotency-Key, new key) (150ms)
  ✓   86 coupons/T-integrations.spec.ts:66:5 › T3 provider webhook without a connection / with bad signature is refused, nothing saved (22ms)
  ✓   87 coupons/U-isolation.spec.ts:13:5 › U every coupon route (220ms)
  ✓   88 coupons/V-permissions.spec.ts:47:5 › V1 role × API matrix (1.0m)
  ✓   89 coupons/V-permissions.spec.ts:78:7 › V2 UI controls for ORG_A_VIEWER (6.8s)
  ✓   90 coupons/V-permissions.spec.ts:78:7 › V2 UI controls for ORG_A_NOPERM (5.8s)
  ✓   91 coupons/W-bad-input.spec.ts:60:7 › W1 discountValue negative (36ms)
  ✓   92 coupons/W-bad-input.spec.ts:60:7 › W2 discountValue zero (31ms)
  ✓   93 coupons/W-bad-input.spec.ts:60:7 › W3 percentage over 100 (25ms)
  ✓   94 coupons/W-bad-input.spec.ts:60:7 › W4 percentage huge (23ms)
  ✓   95 coupons/W-bad-input.spec.ts:60:7 › W5 fixed amount huge (> ₹1,00,00,000) (28ms)
  ✓   96 coupons/W-bad-input.spec.ts:60:7 › W6 discountValue string (27ms)
  ✓   97 coupons/W-bad-input.spec.ts:60:7 › W7 discountValue NaN-ish (22ms)
  ✓   98 coupons/W-bad-input.spec.ts:60:7 › W8 discountType unknown (24ms)
  ✓   99 coupons/W-bad-input.spec.ts:60:7 › W9 maxRedemptions negative (23ms)
  ✓  100 coupons/W-bad-input.spec.ts:60:7 › W10 maxRedemptions zero (25ms)
  ✓  101 coupons/W-bad-input.spec.ts:60:7 › W11 maxRedemptions fractional (22ms)
  ✓  102 coupons/W-bad-input.spec.ts:60:7 › W12 validFrom invalid date (27ms)
  ✓  103 coupons/W-bad-input.spec.ts:60:7 › W13 validUntil not a date (23ms)
  ✓  104 coupons/W-bad-input.spec.ts:60:7 › W14 end before start (28ms)
  ✓  105 coupons/W-bad-input.spec.ts:60:7 › W15 affiliateIds not uuid (26ms)
  ✓  106 coupons/W-bad-input.spec.ts:60:7 › W16 affiliateIds unknown uuid (X: coupon must not be left behind) (27ms)
  ✓  107 coupons/W-bad-input.spec.ts:60:7 › W17 affiliateIds Org B affiliate (X) (27ms)
  ✓  108 coupons/W-bad-input.spec.ts:60:7 › W18 name too long (> 160, DB column) (31ms)
  ✓  109 coupons/W-bad-input.spec.ts:60:7 › W19 description too long (> 2000) (32ms)
  ✓  110 coupons/W-bad-input.spec.ts:60:7 › W20 extra field organizationId (33ms)
  ✓  111 coupons/W-bad-input.spec.ts:60:7 › W21 extra field affiliateId (26ms)
  ✓  112 coupons/W-bad-input.spec.ts:60:7 › W22 extra field usageCount (30ms)
  ✓  113 coupons/W-bad-input.spec.ts:60:7 › W23 extra field redemptionCount (24ms)
  ✓  114 coupons/W-bad-input.spec.ts:60:7 › W24 extra field status (26ms)
  ✓  115 coupons/W-bad-input.spec.ts:60:7 › W25 extra field createdAt (23ms)
  ✓  116 coupons/W-bad-input.spec.ts:60:7 › W26 extra field id (23ms)
  ✓  117 coupons/W-bad-input.spec.ts:60:7 › W27 SQL injection in code (22ms)
  ✓  118 coupons/W-bad-input.spec.ts:72:5 › W-json malformed JSON body (24ms)
  ✓  119 coupons/W-bad-input.spec.ts:83:5 › W-sql SQL injection in name/description is stored as plain text, table intact (22ms)
  ✓  120 coupons/W-bad-input.spec.ts:99:5 › W-invalid-id invalid coupon IDs on read/update/status (85ms)
  ✓  121 coupons/X-no-leftovers.spec.ts:19:5 › X1 create with unknown affiliate (404) leaves no coupon (memory + SQL) (539ms)
  ✓  122 coupons/X-no-leftovers.spec.ts:40:5 › X2 update rejected (400) changes neither memory nor SQL (538ms)
  ✓  123 coupons/X-no-leftovers.spec.ts:56:5 › X3 refused coupon use (limit reached) leaves no use row and no coupon credit (582ms)

  ✓  124 coupons/Y-db-failure.spec.ts:37:5 › Y LOCK TABLES organization_coupons READ during create + edit (19.8s)
  ✓  125 coupons/Y-db-failure.spec.ts:79:5 › Y2 LOCK TABLES organization_coupon_settings READ during the coupons on/off switch (14.3s)
  ✓  126 coupons/Z-export.spec.ts:36:5 › Z export matches SQL, is formula-safe and keeps special characters (5.1s)

  126 passed (6.2m)
```

### 10.2 Other suites

| Repo | Command | Result on `audit/coupons` | Same on `main`? | Raw output |
|---|---|---|---|---|
| backend | `npx tsc --noEmit -p tsconfig.backend.json` | 0 errors | — | `backend-tsc.txt` (empty) |
| backend | `npm run test:unit` | 154/154 tests passed; 1 suite fails to compile: `test/unit/demo-bookings.spec.ts` (TS2554, constructor needs 2 args) | yes — identical on main | `backend-unit.txt`, `main/unit.txt` |
| backend | `npm run test:integration` | no tests exist (`test/integration/**/*.int.spec.ts` matches nothing) — exit 1 "No tests found" | yes | `backend-integration.txt` |
| backend | `npm test` (run-tests.ts) | 19 passed, 0 failed | — | `branch/test.txt` |
| backend | `test:analytics` | all sanity checks passed | — | `branch/test-analytics.txt` |
| backend | `test:invariants` | 34 passed, 0 failed | — | `branch/test-invariants.txt` |
| backend | `test:limits` | 108 passed, 0 failed | — | `branch/test-limits.txt` |
| backend | `test:legal` | 22 passed, 0 failed | — | `branch/test-legal.txt` |
| backend | `test:program-links` | 20 passed, 0 failed; process does not exit (killed by `timeout 300`, exit 124) | yes | `branch/test-program-links.txt` |
| backend | `test:invitations` | 46 passed, 0 failed; process does not exit (exit 124) | yes | `branch/test-invitations.txt` |
| backend | `test:onboarding` | 20 passed, **2 failed** (default commission rule / tier ladder not seeded) | yes — identical | `branch/…`, `main/test-onboarding.txt` |
| backend | `test:oauth` | **error**: registration requires accepting legal documents | yes — identical | `main/test-oauth.txt` |
| backend | `test:attribution` | **error**: USD conversion vs INR program | yes — identical | `main/test-attribution.txt` |
| backend | `test:affiliate-portal` | **crash** in `tax-certificates.service.ts:34` (`inferJurisdiction`) | yes — identical | `main/test-affiliate-portal.txt` |
| backend | `test:sdk`, `test:security` | **cannot start**: `../../sdk/…` moved out of the repo (commit 47da98a) | yes | `main/test-sdk.txt` |
| frontend | `npx vitest run` | 8 files, 119 tests passed (incl. new `coupon-permissions.test.ts`, 5 tests) | — | `frontend-vitest.txt` |
| frontend | `npx tsc --noEmit` | 249 errors — the pre-existing baseline; **0** in files changed by this audit (`git diff --name-only main..HEAD`). The coupon-named errors are in the SaaS billing-coupon admin screens (`src/components/admin/coupons`, `admin/billing`), out of scope | baseline 249 | — |
| portal | `npx vitest run` | 14 files, 143 tests passed | — | `portal-vitest.txt` |
| portal | `npx tsc --noEmit` | 0 errors | — | — |

None of the failures above is in coupon code; all reproduce on `main` unchanged.

Backend unit output (tail):

```

Summary of all failing tests
FAIL test/unit/demo-bookings.spec.ts
  ● Test suite failed to run

    test/unit/demo-bookings.spec.ts:6:21 - error TS2554: Expected 2 arguments, but got 0.

    6     const service = new DemoBookingsService();
                          ~~~~~~~~~~~~~~~~~~~~~~~~~

      src/modules/demo-bookings/demo-bookings.service.ts:26:5
        26     private readonly googleCalendar: GoogleCalendarService,
               ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        An argument for 'googleCalendar' was not provided.


Test Suites: 1 failed, 24 passed, 25 total
Tests:       154 passed, 154 total
Snapshots:   0 total
Time:        29.845 s
Ran all test suites.
Jest did not exit one second after the test run has completed.

'This usually means that there are asynchronous operations that weren't stopped in your tests. Consider running Jest with `--detectOpenHandles` to troubleshoot this issue.
Terminated
```


---------------------------------------------------------------------------------------------------------------------
### 10.3 Test data

All test data (prefix `e2e-cpn-1791051925353`: 4 organizations, 9 users, 50,012 coupons, 55,041 conversions and every
dependent row) was deleted after the final run with `e2e/scripts/cleanup.ts`; afterwards the audit database has 0
organizations, coupons, redemptions and conversions (`coupons-proof/_cleanup.txt`). The billing coupon inserted for S4
was deleted by that spec. No pre-existing (non-test) data existed in the audit database, so there was no leftover data
from other sources to report. To re-run the suite: set `E2E_PASSWORD` (password given to the e2e test users), then `npx tsx e2e/scripts/seed-fixtures.ts`.
The e2e password was hard-coded in the first audit commits; that local, never-pushed history was rewritten before the
first push so no password is in any pushed commit (the test accounts it belonged to are deleted).

---------------------------------------------------------------------------------------------------------------------
## 11. Conclusion

Organization coupons were **verified in a test environment against test data** (MySQL test database, compiled
backend, production builds of the admin app and affiliate portal, single backend instance), with the items in §7 not
tested.
