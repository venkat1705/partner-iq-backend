# @partneriq/sdk

> Official Node.js & TypeScript SDK for PartnerIQ — The B2B SaaS Partner & Affiliate Management Engine.

[![npm version](https://img.shields.io/npm/v/@partneriq/sdk.svg)](https://www.npmjs.com/package/@partneriq/sdk)
[![license](https://img.shields.io/npm/l/@partneriq/sdk.svg)](https://github.com/partneriq/partneriq-node/blob/main/LICENSE)

## Features

- ⚡ **Zero Dependencies** — High performance built on native Node 18+ / Browser Fetch API.
- 🔐 **Server-to-Server Security** — Built-in API Key bearer authentication.
- 🔁 **Idempotency Guarantee** — First-class support for `Idempotency-Key` headers to eliminate duplicate commissions.
- ⚖️ **Double-Entry Ledger Support** — Automatic commission calculation, refunds, and clawbacks.
- 🪝 **Webhook HMAC Verification** — Standard timing-safe signature verification for secure webhook delivery.

---

## Installation

```bash
npm install @partneriq/sdk
# or
yarn add @partneriq/sdk
# or
pnpm add @partneriq/sdk
```

---

## Quick Start

### 1. Initialize the Client

```typescript
import { PartnerIQ } from '@partneriq/sdk';

const partneriq = new PartnerIQ({
  apiKey: process.env.PARTNERIQ_API_KEY!, // e.g., 'pi_live_...'
  baseUrl: 'https://api.partneriq.in',     // Optional (defaults to http://localhost:3000)
  apiKey: process.env.PARTNERIQ_API_KEY!, // e.g., 'pi_live_sk_...'
  baseUrl: 'https://api.partneriq.in',     // Optional (defaults to http://localhost:5000 in dev)
});
```

---

### 2. Track a Conversion Event (Server-Side)

When a customer completes a purchase or upgrades a subscription in your SaaS product, notify PartnerIQ:

```typescript
import { PartnerIQ } from '@partneriq/sdk';

const partneriq = new PartnerIQ({
  apiKey: process.env.PARTNERIQ_API_KEY!,
});

async function handleOrderComplete(order: { id: string; userEmail: string; amountCents: number }) {
  try {
    const result = await partneriq.conversions.track(
      {
        externalId: order.id,              // e.g. 'ORD-10042'
        customerExternalId: order.userEmail, // e.g. 'customer@acme.com' or click ID
        amount: order.amountCents,         // e.g. 19900 ($199.00 in cents)
        currency: 'USD',
        productId: 'pro-annual-plan',
      },
      {
        idempotencyKey: `ord_checkout_${order.id}`, // Guarantees single execution even on retries
      }
    );

    console.log('Conversion recorded:', result.conversion.id);
    console.log('Commission calculated:', result.commission?.commissionAmount);
  } catch (error) {
    console.error('Failed to track conversion:', error);
  }
}
```

---

### 3. Handle Order Refund & Commission Clawback

If a user cancels or refunds their order, claw back the earned commission in the immutable ledger:

```typescript
async function processRefund(orderId: string, conversionId: string) {
  const result = await partneriq.conversions.refund(conversionId, {
    reason: 'Customer requested full refund within 30 days',
  });

  console.log('Status updated:', result.conversionStatus); // 'REFUNDED'
}
```

---

### 4. Verify Webhook Signatures (Express / Next.js)

Verify incoming PartnerIQ webhook notifications using HMAC SHA-256:

```typescript
import express from 'express';
import { PartnerIQ } from '@partneriq/sdk';

const app = express();
const partneriq = new PartnerIQ({ apiKey: process.env.PARTNERIQ_API_KEY! });

app.post('/api/webhooks/partneriq', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-partneriq-signature'] as string;
  const rawBody = req.body.toString('utf-8');
  const secret = process.env.PARTNERIQ_WEBHOOK_SECRET!;

  const isValid = partneriq.webhooks.verifySignature(rawBody, signature, secret);

  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }

  const payload = JSON.parse(rawBody);
  console.log('Received verified event:', payload.event);

  res.status(200).json({ received: true });
});
```

---

## Publishing to npm

To publish this package to npm:

1. **Login to npm**:
   ```bash
   npm login
   ```

2. **Build and test the package**:
   ```bash
   cd sdk
   npm run build
   ```

3. **Publish to registry**:
   ```bash
   npm publish --access public
   ```

---

## License

MIT © [PartnerIQ](https://partneriq.in)
