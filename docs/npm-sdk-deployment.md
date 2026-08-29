# PartnerIQ SDK — NPM Publishing Guide (Industry Architecture)

PartnerIQ follows the industry standard (like Stripe, PostHog, Segment, Supabase) by maintaining **exactly 2 SDKs**:

1. **`@partneriq-io/node`** (Backend SDK) — Server-side Node.js / Next.js / Express / NestJS.
2. **`@partneriq-io/browser`** (Frontend SDK) — Client-side Web / React / Next.js / Vue / Vanilla JS.

---

## 📦 The 2 SDKs at a Glance

```
                               ┌────────────────────────────────┐
                               │       PARTNERIQ PLATFORM       │
                               └──────────────┬─────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    ▼                                                   ▼
       ┌────────────────────────┐                          ┌────────────────────────┐
       │ @partneriq-io/browser  │                          │  @partneriq-io/node    │
       │     (Frontend SDK)     │                          │     (Backend SDK)      │
       ├────────────────────────┤                          ├────────────────────────┤
       │ • Public Browser Key   │                          │ • Secret API Key       │
       │   (pi_live_pk_...)     │                          │   (pi_live_sk_...)     │
       │ • Capture ?ref= query  │                          │ • Create Conversions   │
       │ • Attribution cookies  │                          │ • Commission Clawbacks │
       │ • Client events        │                          │ • Webhook HMAC Verify  │
       └────────────────────────┘                          └────────────────────────┘
```

---

## 🛠️ Step 1: Login to npm

In your terminal / PowerShell:

```powershell
npm login
```

Verify your account:
```powershell
npm whoami
```

---

## 🔨 Step 2: Build & Test Both SDKs

From the `backend/` directory:

```powershell
# 1. Run SDK verification tests
npm run test:sdk

# 2. Build both Backend and Frontend SDKs (produces ESM + CJS + Types)
npm run build:sdks
```

---

## 🚢 Step 3: Deploy Both SDKs to npm

### 1. Deploy the Backend SDK (`@partneriq-io/node`)
```powershell
cd packages/partneriq-node
npm publish --access public
```

### 2. Deploy the Frontend SDK (`@partneriq-io/browser`)
```powershell
cd ../partneriq-browser
npm publish --access public
```

---

## 🔄 Step 4: Releasing Updates (Semantic Versioning)

When releasing bug fixes or new features:

```powershell
# In packages/partneriq-node or packages/partneriq-browser:
npm version patch   # 1.0.0 -> 1.0.1 (bug fix)
npm version minor   # 1.0.0 -> 1.1.0 (new feature)
npm version major   # 1.0.0 -> 2.0.0 (breaking change)

# Build and deploy
npm run build
npm publish --access public
```

---

## 🤖 Step 5: Automated GitHub Actions Publishing

1. Add your npm token as a repository secret named `NPM_TOKEN` on GitHub (`Settings` -> `Secrets and variables` -> `Actions`).
2. Go to **Actions** tab -> **Publish SDKs to npm** -> click **Run workflow** to publish automatically with provenance!
