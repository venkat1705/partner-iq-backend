# PartnerIQ Billing Coupons

This module is only for PartnerIQ SaaS subscription billing coupons. It is intentionally separate from organization-created affiliate or program coupons.

## Architecture

Billing coupons live under `src/modules/billing` and use dedicated platform-level tables:

- `billing_promotions`
- `billing_coupons`
- `billing_coupon_plans`
- `billing_coupon_organizations`
- `billing_coupon_redemptions`
- `billing_subscription_discounts`

`BillingPricingService` is the authoritative pricing engine. Checkout, coupon validation, admin preview, and future invoice/renewal flows must call it instead of recalculating discounts.

## Pricing Flow

1. Frontend sends `planId`, `billingInterval`, and optional `couponCode`.
2. Backend resolves the active plan and normalizes the coupon code.
3. `BillingCouponValidationService` evaluates status, validity window, plan, billing cycle, currency, customer eligibility, limits, and stacking.
4. `BillingPricingService` calculates amounts in integer minor units.
5. Checkout reserves a redemption, creates the provider order/subscription, and stores an immutable pricing snapshot.
6. Provider signature/webhook confirmation consumes the redemption and creates a subscription discount snapshot.

The frontend must never submit authoritative price, discount, tax, trial end, or redemption values.

## Redemption Lifecycle

- `RESERVED`: checkout has started and the coupon is temporarily held.
- `CONSUMED`: trusted provider confirmation activated the subscription.
- `EXPIRED`: reservation TTL elapsed before payment confirmation.
- `FAILED`, `CANCELLED`, `REVERSED`: reserved for payment failures, user cancellation, and financial reversal workflows.

The default reservation TTL is 20 minutes. It can be adjusted with `BILLING_COUPON_RESERVATION_MINUTES`.

## Idempotency And Concurrency

Checkout binds coupon reservations to `organizationId + Idempotency-Key`. Reusing the same key with the same request returns the original checkout response; reusing it with different input fails.

For the in-process store, `BillingCouponService.reserve` uses a coupon-code mutex around validation and insertion so concurrent attempts cannot overrun in-memory limits. The database schema also includes unique constraints for normalized codes and checkout idempotency. Production databases should keep final reservation inside a transaction with row-level locking or an equivalent atomic counter before accepting high-volume coupon traffic.

## Coupon Types

- `PERCENTAGE`: deterministic floor rounding on minor units.
- `FIXED_AMOUNT`: capped at subtotal.
- `TRIAL_EXTENSION`: records extension semantics separately from price discounts.
- `FREE_MONTHS`: records free billing periods separately from percentage discounts.

Recurring benefits are snapshotted in `billing_subscription_discounts` so later coupon edits do not mutate historical terms.

## Admin Workflow

Use platform-admin endpoints under `api/v1/admin/billing/coupons`.

- Create in `DRAFT`.
- Preview with `POST /coupons/preview`.
- Activate with `POST /coupons/:id/activate`.
- Pause or archive instead of hard deleting financially used coupons.
- Inspect redemptions and analytics from `/:id/redemptions` and `/:id/analytics`.

Private negotiated coupons should use `SPECIFIC_ORGANIZATIONS` plus `billing_coupon_organizations`.

## Customer Workflow

Customer checkout uses:

- `POST /organizations/:organizationId/billing/coupons/validate`
- `POST /organizations/:organizationId/billing/pricing/preview`
- `POST /organizations/:organizationId/billing/checkout`

Invalid responses return safe messages and structured codes. Technical rule internals are not exposed.

## Webhooks

Provider webhooks must verify signatures and event idempotency before state changes. Coupon redemptions are consumed only from `verify` or webhook paths after trusted provider confirmation.

## Refunds, Cancellation, And Plan Changes

Historical invoice/payment records must remain immutable. Refunds should create refund records and must not rewrite original discounted amounts. New-customer coupons remain used after cancellation/resubscribe unless a future explicit policy reverses them.

Plan changes should respect each coupon's `planChangePolicy`; current V1 stores the policy and uses eligibility validation at checkout. Renewal and plan-change implementations must snapshot any preserved/revalidated discount.
