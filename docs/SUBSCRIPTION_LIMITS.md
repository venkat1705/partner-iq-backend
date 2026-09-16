# PartnerIQ — Subscription Plans, Resource Limits & Add-on Billing

How PartnerIQ decides whether a customer may create one more organization,
program, affiliate or member — and how they buy more capacity when they can't.

---

## 1. The model

```
Customer Account  (billing_accounts)
└── Subscription  (billing_subscriptions.accountId)
    ├── Plan            → included allowances  (billing_plan_limits)
    ├── Add-on purchases → extra allowances    (billing_addon_purchases)
    └── Organizations   (organizations.accountId)
        ├── Programs
        ├── Affiliates
        └── Members
```

One subscription covers **every** organization the customer owns. Allowances are
counted **account-wide**, never per organization: a Growth customer's ten
programs may be spread across five organizations and the allowance is still ten
in total.

### Why an account layer was added

PartnerIQ previously billed per organization — `billing_subscriptions` had only
an `organizationId`, and `organizations` had no parent. That cannot express
"5 organizations on one Growth subscription".

The account layer was added **without a destructive migration**:

- `organizations.accountId` and `billing_subscriptions.accountId` are nullable.
- The migration backfills one account per organization owner (`createdBy`).
- `BillingAccountService` also backfills lazily, so rows created by an older
  running instance are still adopted.
- Subscription resolution accepts either an account-level row **or** a legacy
  organization-level row on any organization in the account, preferring the
  former. Existing paying customers are unaffected.

---

## 2. Plans

Seeded from `src/modules/billing/config/plan-catalog.ts` into `billing_plans`
and `billing_plan_limits`. The database is authoritative from then on — a
platform admin's edits survive restarts.

| | Starter | Growth | Pro |
|---|---|---|---|
| Monthly | ₹5,000 | ₹10,000 | ₹17,000 |
| Yearly | ₹50,000 | ₹1,00,000 | ₹1,70,000 |
| Organizations | 1 | 5 | Unlimited |
| Programs | 3 | 10 | Unlimited |
| Affiliates | 50 | 200 | Unlimited |
| Members | 5 | 15 | Unlimited |

`FREE` and `ENTERPRISE` remain as private plans. `BUSINESS` is retired — kept so
historical subscriptions resolve, hidden from the pricing page.

### Representing "unlimited"

`billing_plan_limits.includedLimit` is **NULL** for unlimited.

Not `Infinity` (no SQL representation) and not a sentinel like `999999` (which
could collide with a legitimate admin-configured allowance). A plan row with
*no* limit record for a resource is treated as **zero**, never unlimited —
failing closed is the safe default.

### Money

Every monetary value is an **integer in the currency's minor unit** (paise for
INR): ₹5,000 is stored as `500000`. No floating-point arithmetic touches a
price, a tax amount or a total. Tax is a rate in basis points (1800 = 18%).

---

## 3. Add-ons

| Add-on | Price / month | Resource |
|---|---|---|
| Additional Organization | ₹2,000 | ORGANIZATION |
| Additional Program | ₹500 | PROGRAM |
| Additional Affiliate | ₹50 | AFFILIATE |
| Additional Member | ₹200 | MEMBER |

Yearly add-ons bill at 10x the monthly rate, matching the two-months-free
discount already built into the yearly plan prices.

**Effective limit = plan's included allowance + active purchased add-on units.**
An unlimited (`NULL`) allowance short-circuits everything — add-ons cannot be
bought for a resource the plan already makes unlimited.

### Billing model

One base subscription, with recurring add-on charges attached to it. There is
**no** separate provider subscription per add-on. At checkout the customer is
charged only for the new capacity; the higher recurring total applies from the
next cycle.

Capacity is granted **only** when a purchase reaches `ACTIVE`, which happens on
verified payment or on the provider webhook — never at checkout time, and never
from anything the frontend sends. `activatePurchases` is idempotent, so a
verify-then-webhook sequence or a redelivered webhook cannot double-grant.

### Worked example

Starter, plus 2 programs, 25 affiliates and 3 members:

```
Base                       ₹5,000
2 programs   × ₹500        ₹1,000
25 affiliates × ₹50        ₹1,250
3 members    × ₹200          ₹600
                         --------
Subtotal                   ₹7,850
GST 18%                    ₹1,413
                         --------
Total / month              ₹9,263
```

Effective limits become: 1 organization, 5 programs, 75 affiliates, 8 members.

---

## 4. How usage is counted

`SubscriptionUsageService` recounts from the live records on every call. There
is **no cached counter**, which is precisely what keeps usage correct after a
create, delete, deactivate or restore with no reconciliation step.

| Resource | Counted |
|---|---|
| **Organizations** | Non-deleted organizations on the account. |
| **Programs** | Non-deleted **LIVE** programs across those organizations. TEST-environment programs are sandbox scaffolding and are not billed. |
| **Affiliates** | Distinct affiliate records that are `ACTIVE` or `PENDING`, plus live invitations for emails with no record yet. |
| **Members** | Distinct **user ids** holding an `ACTIVE` membership in any of the account's organizations, plus live invitations for people who are not already members. |

### Affiliates in many programs count once

An `affiliates` row is unique per `(organizationId, email)`. Joining five
programs writes five `program_affiliates` rows and no additional affiliate row,
so a partner in many programs consumes exactly one slot. `program_affiliates`
is never counted.

`SUSPENDED` and `REJECTED` affiliates release their slot, as do expired and
revoked invitations — nothing is held forever and nothing is deleted.

### One person, many organizations = one seat

Members are counted by distinct user id. An admin who administers three
organizations on the same account holds one seat.

### Invitations reserve a slot

A live invitation (affiliate or member) consumes capacity. Without this an admin
could invite fifty partners on a fifty-affiliate plan and only discover the
problem when they all accept. When an invited partner accepts, the slot is
already theirs, so acceptance is never blocked.

---

## 5. Enforcement

Every metered write goes through `SubscriptionLimitService`, which:

1. Resolves the account's subscription (account-level preferred, legacy
   organization-level accepted).
2. Reads the plan's included allowance from `billing_plan_limits`.
3. Adds active purchased add-on units.
4. Recounts current usage from the database.
5. Compares, and throws `ResourceLimitReachedException` if over.

### Enforcement points

| Resource | Service | Method |
|---|---|---|
| Organization | `OrganizationsService` | `create` (and therefore `onboardingOrg`) |
| Program | `ProgramsService` | `create` (LIVE only) |
| Affiliate | `AffiliatesService` | `create`, `inviteAffiliate` — and therefore invitation acceptance and application approval, which both route through `create` |
| Member | `MembershipsService` | `inviteMember` |

There is no frontend-only validation anywhere. The browser always makes the
request and the server decides.

### Concurrency

Two users racing for the fiftieth affiliate slot must not both succeed.
`LimitLockService` provides two layers:

1. **In-process promise chain** keyed by `account:resource`. This is what makes
   concurrency correct for everything reading the write-through store inside one
   node.
2. **MySQL named lock** (`GET_LOCK`/`RELEASE_LOCK`) on the same key, held on a
   dedicated connection — a true cross-process critical section. If the database
   is unreachable the in-process lock still applies and the operation proceeds
   rather than failing closed.

The check and the write happen **inside** the lock (`SubscriptionLimitService.reserve`),
so a pre-flight check followed by a later write is never the pattern used.

Deliberately **no usage-counter table**: a counter is a second source of truth
that drifts from the real rows. Usage is recounted from the actual records
inside the lock instead.

Verified by the test suite: 2 concurrent requests for 1 remaining slot produce
exactly 1 success, and 20 concurrent requests for 5 remaining slots produce
exactly 5.

---

## 6. The structured error

Rejections return **HTTP 402 Payment Required** — the caller is authorized, the
account simply has no capacity and the remedy is a purchase.

```json
{
  "success": false,
  "code": "RESOURCE_LIMIT_REACHED",
  "message": "You have reached your program limit (3/3). Purchase additional program capacity or upgrade your plan.",
  "details": {
    "resource": "PROGRAM",
    "currentUsage": 3,
    "includedLimit": 3,
    "additionalPurchased": 0,
    "effectiveLimit": 3,
    "remaining": 0,
    "canPurchaseAddon": true,
    "canUpgradePlan": true,
    "planCode": "STARTER",
    "planName": "Starter",
    "accountId": "…",
    "addon": {
      "id": "…",
      "code": "ADDON_PROGRAM",
      "name": "Additional Program",
      "unitPrice": 50000,
      "currency": "INR",
      "billingInterval": "MONTHLY"
    }
  }
}
```

The frontend keys off `code`, reads `details`, and opens the capacity dialog —
offering the **add-on first**, so nobody is pushed onto a bigger plan when a
smaller purchase solves the problem.

---

## 7. Upgrade and downgrade

**Upgrade** applies immediately. Existing add-ons are kept and stack on top of
the new plan's allowance. Included capacity is never double-counted, because the
new plan's allowance *replaces* the old one rather than adding to it.

**Downgrade** is scheduled for the end of the period and is **refused** when
current usage would not fit the target plan (its allowance plus retained
add-ons). The rejection names exactly which resources are over and by how much.

Nothing is ever deleted, disabled or hidden by a plan change. The customer
either reduces usage themselves or keeps enough add-on capacity to cover it.
`GET …/subscription/plan-change/:planId/preview` is a dry run of this check.

---

## 8. API

### Public

```
GET  /api/v1/billing/plans?billingInterval=MONTHLY
GET  /api/v1/billing/plans/catalog        # plans + add-ons + tax, both intervals
```

### Customer (requires `billing.view`; purchases require `billing.subscribe`,
management requires `billing.manage`)

```
GET    /api/v1/organizations/:organizationId/subscription/account
GET    /api/v1/organizations/:organizationId/subscription/usage
GET    /api/v1/organizations/:organizationId/subscription/limits
GET    /api/v1/organizations/:organizationId/subscription/summary
GET    /api/v1/organizations/:organizationId/subscription/addons
GET    /api/v1/organizations/:organizationId/subscription/addons/purchased
POST   /api/v1/organizations/:organizationId/subscription/addons/preview
POST   /api/v1/organizations/:organizationId/subscription/addons/purchase
PATCH  /api/v1/organizations/:organizationId/subscription/addons/:purchaseId
DELETE /api/v1/organizations/:organizationId/subscription/addons/:purchaseId
GET    /api/v1/organizations/:organizationId/subscription/plan-change/:planId/preview

POST   /api/v1/organizations/:organizationId/billing/subscription/upgrade
POST   /api/v1/organizations/:organizationId/billing/subscription/downgrade
POST   /api/v1/organizations/:organizationId/billing/subscription/preview
POST   /api/v1/organizations/:organizationId/billing/subscription/cancel
GET    /api/v1/organizations/:organizationId/billing/invoices
GET    /api/v1/organizations/:organizationId/billing/payments
```

### Platform admin (`PlatformAdminGuard` + `billing.admin`)

```
GET    /api/v1/admin/billing/configuration
PATCH  /api/v1/admin/billing/configuration/plans/:planId
PATCH  /api/v1/admin/billing/configuration/addons/:addonId
PATCH  /api/v1/admin/billing/configuration/tax
```

### Examples

**Read limits**

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://api.partneriq.in/api/v1/organizations/$ORG/subscription/limits
```

```json
{
  "accountId": "…",
  "planCode": "STARTER",
  "planName": "Starter",
  "entitled": true,
  "canUpgradePlan": true,
  "usage": { "organizations": 1, "programs": 3, "affiliates": 42, "members": 4 },
  "limits": {
    "PROGRAM": {
      "resourceType": "PROGRAM",
      "currentUsage": 3,
      "includedLimit": 3,
      "additionalPurchased": 0,
      "effectiveLimit": 3,
      "remaining": 0,
      "unlimited": false,
      "atLimit": true,
      "percentUsed": 100,
      "canPurchaseAddon": true,
      "addon": { "id": "…", "code": "ADDON_PROGRAM", "unitPrice": 50000, "currency": "INR" }
    }
  }
}
```

**Price an add-on purchase** (no charge, nothing persisted)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"addonId":"<program-addon-id>","quantity":2}]}' \
  https://api.partneriq.in/api/v1/organizations/$ORG/subscription/addons/preview
```

Note the request carries **no price** — only which add-on and how many. Unit
prices come from the catalog on the server.

**Purchase** (idempotent)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" \
  -d '{"items":[{"addonId":"<program-addon-id>","quantity":2}],"confirmed":true}' \
  https://api.partneriq.in/api/v1/organizations/$ORG/subscription/addons/purchase
```

Returns a provider order for the amount due now. Capacity activates on payment
confirmation.

**Reprice a plan as a platform admin**

```bash
curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"price":600000,"limits":[{"resourceType":"AFFILIATE","includedLimit":75}]}' \
  https://api.partneriq.in/api/v1/admin/billing/configuration/plans/$PLAN_ID
```

`"includedLimit": null` (or omitting it) sets that resource to unlimited.

---

## 9. Security

- **Tenant isolation** — every customer route is scoped by `:organizationId`, so
  `OrganizationGuard` applies exactly as elsewhere; the account is then resolved
  from that organization. `AddonService` re-checks that a purchase belongs to
  the caller's account before mutating it.
- **RBAC** — reads need `billing.view`; purchases need `billing.subscribe`;
  changes need `billing.manage`. Only owners and admins hold these. Platform
  configuration additionally requires `PlatformAdminGuard`.
- **Server-side pricing** — purchase and preview DTOs have no price field at
  all. A client can only choose which add-on and how many.
- **No frontend bypass** — limits are enforced in the service layer, below the
  controllers, so an API call that skips the UI is checked identically.
- **Idempotency** — add-on checkout honours `Idempotency-Key`, and reusing a key
  with a different payload is rejected.
- **Audit** — plan changes, add-on purchases, quantity changes, cancellations
  and configuration edits all write `audit_logs` rows.

---

## 10. Deployment

1. **Migrate**

   ```bash
   cd backend
   npm run migration:run
   ```

   Creates `billing_accounts`, `billing_plan_limits`, `billing_addons`,
   `billing_addon_purchases`; adds the nullable `accountId` columns; and
   backfills accounts from `organizations.createdBy`.

   The migration is idempotent — `CREATE TABLE IF NOT EXISTS`, and column and
   index additions are guarded against `information_schema`.

   > The data source runs with `synchronize: true`, so the new entities are
   > also created on boot. Running the migration explicitly is still preferred
   > in production, because only the migration performs the account backfill.

2. **Deploy the backend.** On first boot `PlanService.ensureDefaultPlans` and
   `AddonService.ensureDefaultAddons` write the catalog. Seeding is
   version-guarded by `PLAN_CATALOG_SEED_VERSION`, so later admin edits are not
   overwritten on restart. To force a re-seed, bump that constant.

3. **Map provider plans (optional).** For Razorpay recurring subscriptions, set
   `RAZORPAY_<CODE>_<INTERVAL>_PLAN_ID` (e.g. `RAZORPAY_GROWTH_MONTHLY_PLAN_ID`)
   and `BILLING_USE_RAZORPAY_SUBSCRIPTIONS=true`. Without these, checkout uses
   orders, which is the existing behaviour.

4. **Deploy the frontend.** The pricing page, billing dashboard and add-on
   checkout read the catalog from the API — no build-time price data.

5. **Verify**

   ```bash
   cd backend && npm run test:limits
   ```

### Rollback

`npm run migration:revert` drops the four new tables and the two `accountId`
columns. No pre-existing table or column is modified, so a revert loses only the
account/add-on data introduced here.

### Behaviour change to note

New organizations now start their 14-day trial on **GROWTH** rather than PRO.
PRO is unlimited, so trialling on it would leave every allowance unenforced for
14 days and then collapse hard at conversion. GROWTH gives a realistic, enforced
set of limits during the trial.

---

## 11. Tests

`npm run test:limits` — 108 assertions, no database required (the services
degrade gracefully when the data source is not initialised).

Covers: the plan catalog prices and allowances; Starter / Growth / Pro limits
for all four resources including the reject-at-N+1 boundary; account-wide
counting across multiple organizations; add-on capacity for each resource;
add-on cancellation releasing capacity; a partner in three programs counting
once; suspend/restore freeing and reclaiming slots; soft-delete and restore;
TEST-environment programs not being billed; one person across three
organizations being one seat; live vs expired invitations; 2-way and 20-way
concurrency races; upgrade, add-on stacking without double-counting, and
downgrade blocking with and without retained add-ons; cross-account isolation;
server-side pricing and tax; integer-only money; and rejection of invalid
quantities.
