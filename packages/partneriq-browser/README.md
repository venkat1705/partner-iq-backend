# @partneriq-io/browser

Lightweight first-party attribution SDK for PartnerIQ.

```ts
import { PartnerIQ } from '@partneriq-io/browser';

PartnerIQ.init({
  publicKey: process.env.NEXT_PUBLIC_PARTNERIQ_PUBLIC_KEY!,
});

await PartnerIQ.trackReferral();
await PartnerIQ.identify({ customerId: user.id });
```

Use only `pi_test_pk_...` or `pi_live_pk_...` keys. The browser SDK stores non-secret `pi_anonymous_id` and `pi_attribution_id` values in first-party storage and cookies with `SameSite=Lax`.

Browser tracking is not a trusted conversion source. Create conversions from your backend with `@partneriq-io/node` or the REST API.
