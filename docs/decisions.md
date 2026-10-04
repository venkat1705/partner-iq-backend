# Decisions log

Each decision: question, option chosen, why (order: existing code/docs/UI promise → industry practice (Impact,
PartnerStack, Refersion, Rewardful, Shopify; for storage: AWS/S3 guidance) → safest for money/data → easiest to change
later), and the commit. Repos: BE = partner-iq-backend, FE = partner-iq-frontend, AP = partner-iq-affiliate-portal.

## Assets & Bundles audit (branch audit/assets-bundles)

| # | Question | Decision | Why | Commit |
|---|---|---|---|---|
| A0 | Branch name: the first version of the task said `feature/assets-bundles`, the hard limits allow only `audit/*` | `audit/assets-bundles` in every repo (the revised task names it too) | Hard limit "work only on audit/* branches". | — |
| A1 | Where the e2e tests live | `e2e-assets/` (separate from the coupons audit's `e2e/`) | avoids add/add conflicts when both audit branches are merged; the coupons branch is not merged yet. | — |
| A2 | MinIO install | Built from source through the Go module proxy (official binary and GitHub downloads are blocked by the network policy) | Real S3-compatible service for every scenario, as required. | — |
| A3 | `xlsx` during `npm install` | Temporarily pointed at registry 0.18.5 for the install, original spec and lock entry restored | `cdn.sheetjs.com` is blocked; the committed manifest must keep the team's chosen xlsx build. | — |
