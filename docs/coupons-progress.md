# Coupons audit — progress log

Branch: `audit/coupons` (backend, frontend, affiliate-portal).
Re-read this file and the task prompt after any context compaction.

## Phase 0 — environment (done, awaiting Checkpoint 0 reply)

- MySQL 8.0.46 (apt `mysql-server`, Docker daemon not running in container), DB `partneriq_coupons_audit`, user `piq`@localhost.
- Fresh-DB migrations are NOT self-sufficient: `migration:run` failed at
  `AffiliateInvitationLifecycle2026091700000` (`affiliate_invitations` doesn't exist) because no earlier
  migration creates it; the schema is actually built by `synchronize: true` in `src/database/data-source.ts`.
  Worked around: started the app once (synchronize), then `migration:run` applied the remaining 9 (18 total).
- Backend `npm ci` fails (lockfile missing `@emnapi/runtime@1.11.3`); `xlsx` tarball host `cdn.sheetjs.com` is
  blocked by this environment's network policy. Installed with `xlsx@0.18.5` from npm temporarily, then restored
  package.json/package-lock.json (not committed). xlsx is only used by `affiliates.service.ts`.
- Backend run with `npm run build && npm start` (compiled). `tsx src/main.ts` breaks Nest DI (no decorator
  metadata) — not used.
- Playwright 1.56.1 in `e2e/package.json` (separate so the backend lockfile is untouched), Chromium 141 from /opt/pw-browsers.
- Note: prompt says NestJS 10; package.json has @nestjs/* ^11.1.28.

| Service | URL |
|---|---|
| Backend API | http://localhost:5000/api/v1 (Swagger http://localhost:5000/api/docs) |
| Admin frontend | http://localhost:3001 (Vite proxies /api → :5000) |
| Affiliate portal | http://localhost:3005 |

## Scenarios

(none run yet)
