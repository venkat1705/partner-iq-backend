# @partneriq-io/node

Official Node.js 18+ SDK for PartnerIQ.

```ts
import { PartnerIQ } from '@partneriq-io/node';

const partneriq = new PartnerIQ({
  apiKey: process.env.PARTNERIQ_API_KEY!,
});

await partneriq.conversions.create(
  {
    externalId: order.id,
    customerExternalId: user.id,
    amount: 1000000,
    currency: 'INR',
  },
  { idempotencyKey: `order:${order.id}` },
);
```

Use `pi_test_sk_...` for Test Mode and `pi_live_sk_...` for Live Mode. Never expose secret keys in browser bundles or `NEXT_PUBLIC_` environment variables.

This SDK contains no commission, fraud, attribution, ledger, or payout business logic. PartnerIQ backend remains authoritative.
