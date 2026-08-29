# PartnerIQ Developer Platform

## Quickstart

```env
PARTNERIQ_API_KEY=pi_test_sk_xxx
NEXT_PUBLIC_PARTNERIQ_PUBLIC_KEY=pi_test_pk_xxx
PARTNERIQ_WEBHOOK_SECRET=whsec_xxx
```

Never prefix secret API keys with `NEXT_PUBLIC_`. Webhook secrets are server-only secrets.

Browser:

```ts
import { PartnerIQ } from '@partneriq-io/browser';

PartnerIQ.init({
  publicKey: process.env.NEXT_PUBLIC_PARTNERIQ_PUBLIC_KEY!,
});

await PartnerIQ.trackReferral();
await PartnerIQ.identify({ customerId: user.id });
```

Backend:

```ts
import { PartnerIQ } from '@partneriq-io/node';

const partneriq = new PartnerIQ({
  apiKey: process.env.PARTNERIQ_API_KEY!,
});

await partneriq.conversions.create(
  {
    externalId: order.id,
    customerExternalId: user.id,
    amount: order.amount,
    currency: 'INR',
  },
  { idempotencyKey: `order:${order.id}` },
);
```

## REST API v1

- `POST /api/v1/conversions`
- `GET /api/v1/conversions/:id`
- `POST /api/v1/conversions/:id/refund`
- `POST /api/v1/customers/identify`
- `POST /api/v1/attributions/attach-order`
- `POST /api/v1/tracking-links`
- `GET /api/v1/programs`
- `GET /api/v1/affiliates/:id`
- `POST /api/v1/webhook-endpoints`
- `GET /api/v1/webhook-endpoints`
- `POST /api/v1/browser/referrals`
- `POST /api/v1/organizations/:organizationId/public-browser-keys`
- `GET /api/v1/organizations/:organizationId/public-browser-keys`

Secret-key endpoints require `Authorization: Bearer pi_test_sk_xxx` or `Authorization: Bearer pi_live_sk_xxx`.

## Existing Razorpay Checkout

PartnerIQ does not replace Razorpay. Attach the provider order to PartnerIQ attribution, then create a trusted backend conversion after payment success.

```ts
const razorpayOrder = await razorpay.orders.create({
  amount: 200000,
  currency: 'INR',
});

await partneriq.attributions.attachOrder({
  attributionId,
  provider: 'RAZORPAY',
  externalOrderId: razorpayOrder.id,
  amount: 200000,
  currency: 'INR',
});

await partneriq.conversions.create(
  {
    externalId: razorpayOrder.id,
    customerExternalId: user.id,
    amount: 200000,
    currency: 'INR',
  },
  { idempotencyKey: `order:${razorpayOrder.id}` },
);
```

Cashfree and Juspay use the same normalized `attachOrder` API with `provider: 'CASHFREE'` or `provider: 'JUSPAY'`.

## Webhooks

PartnerIQ signs outgoing webhook payloads with HMAC SHA-256.

Headers:

- `PartnerIQ-Event`
- `PartnerIQ-Delivery`
- `PartnerIQ-Timestamp`
- `PartnerIQ-Signature`

Signature input is `timestamp + "." + rawBody`. Store `PartnerIQ-Delivery` to dedupe deliveries.

## Test and Live Isolation

`pi_test_sk_` and `pi_test_pk_` operate in Test Mode. `pi_live_sk_` and `pi_live_pk_` operate in Live Mode. Test conversions must never create live payout liability.

## Security Notes

- SDKs do not calculate fraud, commissions, payouts, attribution rules, or ledger entries.
- Browser SDK cannot create trusted conversions.
- Metadata is size and depth limited.
- Webhook URLs must use HTTPS and cannot point at local/private network hosts.
- Raw API keys are hashed and shown exactly once.
