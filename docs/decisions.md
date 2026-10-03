# Coupons audit — decisions log

Each decision: the question, the option chosen, why (order of preference: existing code/UI promise → industry
practice → safest for money/data → easiest to change later), and the commit that implements it.
Commit hashes are on branch `audit/coupons` of the repo named in the commit column (BE = partner-iq-backend,
FE = partner-iq-frontend, AP = partner-iq-affiliate-portal).

## Money first

| # | Question | Decision | Why | Commit |
|---|---|---|---|---|
| D5 | Is commission on the price before or after the discount? | After: `POST /conversions` `amount` = what the customer paid after the coupon, excluding tax/shipping; commission = `amount × rate` (the existing formula, unchanged). Optional `metadata.orderSubtotal` = price before discount. | Standing rule; the commission code already multiplies `amount`; Rewardful/Refersion pay on the net order. Never pays on money the merchant did not receive. | BE 52aa339 (DTO doc + coupon math) |
| D6 | How is the discount of a sale known? | Stored per sale in `organization_coupon_redemptions` (paise). From `orderSubtotal` when sent (capped at the subtotal), else derived from the coupon: % → gross = round(paid×100/(100−p)); fixed → gross = paid + value. Rounding: half away from zero to the paisa. | History must not change when the coupon is edited (H); merchant data wins when available. | BE b2bf59f, 52aa339 |
| D7 | When is a use counted, and do refunds give it back? | Counted when the sale is recorded with an applicable coupon. Refunds never give the use back; the redemption row records `refundedAmount`/`status`. A refused coupon (paused, archived, expired, not started, limit reached, per-customer limit, unknown) does **not** block the sale: the sale is recorded without coupon credit and the API answers `coupon.applied=false` + `reason`. | Standing rule. Rejecting the sale would lose a real order ("never lose a record"); not applying the coupon means no coupon credit/commission from it ("never overpay"). | BE 52aa339 |
| D7b | How are limits enforced under concurrency? | MySQL: per-coupon row in `organization_coupon_usage` locked with `SELECT … FOR UPDATE` in the same transaction that inserts the redemption; unique keys on redemption `conversionId` and `(org, env, order id)`; deadlock retried ≤ 4 times. | Standing rule ("atomically in the database"); works across several backend instances, unlike the in-memory store. | BE b2bf59f, 52aa339 |
| D11 | Refund after the commission was paid out | Carry the negative EARNED balance (existing ledger behaviour: no clamp), offset by future commissions; show it to admins (`ledgerBalance` in by-affiliate analytics + "Balance" column, red when negative). | Standing rule; no hidden write-offs. | BE 4f96bd9, FE (see below) |
| D11b | `LedgerService.getAccount` never persisted a new account's balance (outside coupons) | Fixed minimally (use the stored proxy). | It blocked scenario Q (payouts saw no balance) and silently loses affiliate money after a restart. One-line, isolated change; store.ts untouched. | BE 1c47bb3 |
| D12 | KPI definitions | uses = redemption rows in range (sale `occurredAt`); attributed = conversion status APPROVED / CONFIRMED / PENDING / PARTIALLY_REFUNDED (existing set + partial refunds); gross = Σ(gross − refunded); discount = Σ discount; commission = Σ net commission; active coupons exclude expired. | Existing statuses kept; refunded/rejected money excluded; table and KPI agree on "expired". | BE 4f96bd9 |
| D18 | A ₹0 order (100 % coupon) | `amount: 0` accepted only when a coupon applies; it counts as a use and earns no commission (not even a fixed per-sale one). | Without it 100 %-off uses were unrecordable and unlimited; paying a fixed commission on a free order would overpay. | BE 52aa339 |

## Credit

| # | Question | Decision | Why | Commit |
|---|---|---|---|---|
| D4 | Who gets credit when a coupon is used (and another affiliate's link was clicked)? | Use the **existing per-program setting** `couponAttributionPriority` ("Collision Priority" in the program form). `PROMO_CODE` (default) and `LAST_CLICK` → the coupon's affiliate; `AFFILIATE` → the click affiliate, coupon affiliate as fallback. The credited affiliate's own program is used for the commission rate. | The code and UI already define this setting with the required default; the standing rule asked for a per-org setting, but rule order puts the existing documented rule first. | BE 52aa339 |
| D4b | A coupon assigned to several affiliates, or to none | Coupon credit only when exactly one ACTIVE affiliate is assigned; otherwise the click affiliate (if any). An unassigned coupon credits nobody (no "only affiliate in the org" fallback for coupon sales). UI text "All Affiliates / eligible across all partners" replaced by "Unassigned". | Never guess who gets paid; the old text promised something the code never did. | BE 52aa339, FE |
| D9 | Moving a coupon | Past sales keep their affiliate (conversion + redemption rows); by-affiliate analytics group by the affiliate credited at sale time. | Standing rule. | BE 4f96bd9 |

## Codes, dates, lifecycle

| # | Question | Decision | Why | Commit |
|---|---|---|---|---|
| D3 | Code format | Trim + uppercase, stored uppercase; 2–40 chars `A–Z 0–9 - _`, first char letter/digit; unique per org incl. archived (DB unique key); duplicate → 409. Lookups (checkout metadata) still strip inner spaces and ignore case. | Standing rule; 40 keeps codes typeable and under the 60-char column; the first-char rule also blocks spreadsheet formula prefixes. | BE 4f96bd9 (+ migration b2bf59f) |
| D3b | Look-alike characters | Non-ASCII letters rejected (Cyrillic/Greek/emoji). Latin O/0, I/l are legal ASCII and stay distinct codes; the generator alphabet excludes 0, O, 1, I and never proposes an existing code. | Standing rule. | BE 4f96bd9, FE |
| D10 | Start/end dates and timezone | `YYYY-MM-DD` = calendar day in `organization_settings.timezone` (fallback UTC): start 00:00:00, end 23:59:59 inclusive (timestamp columns are whole seconds, so validity runs through the end of that second). ISO timestamps are exact instants. Validity is checked at the sale's `occurredAt`. The UI sends date-only values. | Standing rule; the UI previously sent UTC midnight, which excluded the chosen end day. | BE 4f96bd9, 52aa339, FE |
| D10b | Where to read the org timezone | From MySQL (30 s cache), not dbStore. | `dbStore.organizationSettings` is always empty after a restart (store load block throws on unregistered entities; reported, store.ts not edited). | BE 4f96bd9 |
| D9b | Delete | No hard delete. Archive = soft delete: terminal (cannot be edited, assigned or reactivated), code never reusable, history kept. Archiving requires `coupons.delete` ("Archive organization product coupons" in the catalog). UI asks for confirmation. | Standing rule; the catalog already describes `coupons.delete` as archive. | BE 4f96bd9, FE |
| D19 | Limit set below current usage | Rejected (400). End date moved into the past: allowed (the coupon simply expires). Code change after creation: rejected (code is immutable; the UI already disables it). | Lowering a limit below reality would make "remaining uses" negative/misleading. | BE 4f96bd9 |

## Security, UI, scope

| # | Question | Decision | Why | Commit |
|---|---|---|---|---|
| D1 | Affiliate portal in scope? | Yes, coupon screens/API only. Contract kept; response fields only added. | User decision 2026-10-03. | AP |
| D2 | Billing coupons in scope? | No; only the boundary is reported. No billing code changed. | User decision 2026-10-03. | — |
| D13 | Code-check endpoint (`GET …/coupons/validate/:code`) | It is the admin "Validate Code" tool (JWT + `coupons.view`, org-scoped), not a public checkout endpoint, so it keeps its specific reasons (the same user can list every coupon). Added: 30 requests/min limit; no assigned affiliates/emails in the response. No public code-check endpoint exists, so none was added. | UI promise ("verify whether … valid, active, within its date window, and below its quota") + standing rule for the parts that matter. | BE 4f96bd9 |
| D14 | VIEWER / no-permission users in the UI | Controls a role cannot use are not rendered (create/edit/assign/pause/archive/enable). ANALYST no longer gets a Coupons page (backend ANALYST has no coupons permission). | API already refused; the UI offered actions that could only fail. | FE |
| D15 | CSV export (shared DataTable) | Cells starting with `= + - @` (or tab/CR) are prefixed with `'`; UTF-8 BOM + CRLF; per-column export values (coupon table exports Code, Name, Discount, Status, Usage, Assigned Partners, Validity). | Formula-injection fix is safe for every table; columns were exporting JSON blobs. | FE |
| D16 | Large-data limits for AE | p95 ≤ 1000 ms for list/search/filter pages and checkout sale, ≤ 300 ms for the code check, ≤ 2000 ms for the lifetime overview, measured over 20 runs. | Interactive-page budgets. | e2e |
| D17 | AE volume | 50,000 coupons + 55,000 uses instead of 200,000: the backend cannot boot with more than ~62,000 rows in any dbStore table (`super(...items)` in store.ts overflows the stack). Reported as BLOCKED for 200,000. | Measured limit; store.ts may not be edited in this task. | e2e |
| D20 | Coupon API pagination | Optional `page/limit/search/status/discountType/affiliateId/sortBy/sortDir` on `GET /coupons`; without `page` the legacy array is returned (admin UI unchanged). | Backward compatible; needed for AE. | BE 4f96bd9 |
| D21 | Tests vs dev-mode noise | UI scenarios run against a production build (`vite build` + `vite preview`), because React StrictMode doubles effects only in development. | "No duplicate requests" is about real users. | e2e |

## Added after the full runs

| # | Question | Decision | Why | Commit |
|---|---|---|---|---|
| D22 | Admin page loads log the user out ~15 % of the time (two concurrent `/auth/refresh` calls from `auth-context.tsx:166` and `admin-context.tsx:161`; the backend revokes the session on refresh-token reuse) | **Not fixed** — reported with proof (`docs/coupons-proof/auth-reload-race.txt`: 3 of 20 reloads). The e2e UI helpers log each occurrence there and sign in again once. Suggested fix: route both boot calls through the single-flight refresh in `src/lib/api/client.ts`. | Shared auth/session code, security-sensitive, outside the organization-coupons scope; the backend's reuse detection is deliberate and must not be weakened. | e2e ab3cc67 |
| D23 | Coupons on/off switch written memory-first | MySQL first (`INSERT … ON DUPLICATE KEY UPDATE`, 5 s lock wait, 503 on failure) — same rule as create/edit. | Standing rule "never return success when an operation failed" (Y2 showed 200 while the write was blocked). | BE 015730a |
| D24 | Coupon-settings request made twice per page load (layout + page) | Share the answer for 30 s per org; `updateSettings` clears it. | Scenario A requires no duplicate requests; a 30 s stale "enabled" flag is harmless because the backend enforces the switch on every coupon route. | FE 8cb16bb |
| D25 | UI text changed (prompt AF: "don't remove UI text without asking") | Changed only where the text was false: "All Affiliates / eligible across all partners" → "Unassigned" (D4b); fabricated `customer@partneriq.in` → "Customer email not reported" (BE no longer invents it); portal "Status: ACTIVE" on expired coupons → "Expired — do not share". **Listed for your review** (later standing instruction: decide, don't ask). | Keeping text that promises something the code does not do misleads admins about who is paid. Reverting is a one-line change each. | BE 4f96bd9, FE 157ad54, AP 53eee6e |
