# Assets & Bundles audit — progress log

Branch `audit/assets-bundles` in backend, frontend and affiliate portal (created from each repo's `main`).
Re-read this file and the task prompt after any context compaction.

## Task essentials (must survive compaction)
- Parts: 1 discovery → docs/assets-inventory.md; 2 central S3 StorageService (src/common/storage, @Global, one config,
  one key builder, streaming multipart uploads frontend→backend→S3, magic bytes, SHA-256, headObject check, signed
  5-min downloads, attachments for script-capable types, streaming ZIPs, bucket settings as code, error mapping +
  retries in one place, logging without secrets, ESLint no-restricted-imports + a test, move every file usage incl.
  avatars/logos, migrate existing files keeping originals, MinIO test env); 3 per-org limit 3,221,225,472 bytes
  (MySQL counter via TypeORM repo, atomic conditional reserve, 413/411, reserved→used in the asset transaction,
  trash 30 days, versions count, cleanup + reconciliation jobs, platform-admin-only limit change, UI bar/warnings/
  pre-check/full state); 4 scenarios A–AN (letters exact, API/DB/S3/UI/Refresh each).
- Rules carried over: decide don't ask; decisions in docs/decisions.md; raw output as proof; failing test first for
  every bug; never commit to main / force-push; never touch real data; never commit secrets/.env; never change billing
  code (list billing file usage only); never weaken tests; never swallow errors; never edit src/database/store.ts;
  reversible lossless migrations; never say "production ready" — only "verified in a test environment against test
  data" + what was not tested. Final: docs/assets-audit.md (10 sections), all suites raw output, push
  audit/assets-bundles in every changed repo, summary with money/security first.

## Environment (2026-10-04)
- MySQL 8 test DB `partneriq_assets_audit` (new, empty). Coupons audit DB untouched.
- MinIO built from source with Go 1.24.7 via proxy.golang.org (dl.min.io and GitHub downloads are blocked by the
  network policy): `/opt/minio/gopath/bin/minio`, data `/opt/minio/data`, API 127.0.0.1:9000, credentials generated
  into root-only `/opt/minio/etc/env` (never committed), local KMS key for SSE. `mc` client built the same way.
- AWS SDK v3 (`@aws-sdk/client-s3`, `lib-storage`, `s3-request-presigner` 3.1146.0) + `busboy` added to package.json.
  npm cannot fetch `xlsx` from cdn.sheetjs.com (blocked), so the install ran with xlsx temporarily pointed at the npm
  registry 0.18.5 and the original xlsx spec + lock entry were restored afterwards.
- Disk: 27 GB free at start (`df -h /`), enough for the 3 GB boundary test.

## Part 1 — discovery: done → docs/assets-inventory.md
Headline findings: no file is stored anywhere (upload URL route does not exist, UI never sends bytes); portal asset
list leaks every asset of the org (drafts/archived/deleted) and its download links are empty; PARTNER_TIER /
AFFILIATE_SEGMENT bundles are visible to everyone; no admin bundle UI; fake portal ZIP; 50 GB fake quota;
images/avatars/logos go to Cloudinary as base64 JSON; tax certificates store a client-supplied URL.

## Part 2/3 — storage service + limit (2026-10-04)
- 6482759 storage module, accounting tables + reversible migration, ESLint rule + architecture test.
- 889ebce e2e-assets harness + failing baselines (docs/assets-proof/baseline).
- 51b41fe asset module rewritten on StorageService + quota (uploads, trash, versions, bundles, portal access,
  jobs, media off Cloudinary). Unit: asset-bundle-access 8/8, storage-architecture 5/5; npm test 19/19.
- Next: admin UI (multipart upload with progress, storage bar/warnings/full state, trash, versions, bundles tab),
  portal (signed downloads, bundles, locked state, real ZIP), then scenario specs A–AN.
