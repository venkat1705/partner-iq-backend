# Assets & Bundles — storage service, 3 GB limit, audit

Branch `audit/assets-bundles` in partner-iq-backend (BE), partner-iq-frontend (FE) and partner-iq-affiliate-portal (AP).
Everything below was **verified in a test environment against test data**: MySQL 8 (`partneriq_assets_audit`),
MinIO (S3-compatible) on 127.0.0.1:9000, the compiled backend, and production builds of both frontends (vite preview).
Raw proof for every scenario is in `docs/assets-proof/<letter>.txt`; failing-first proof in `docs/assets-proof/baseline/`;
suite output in `docs/assets-proof/suites/`. Decisions: `docs/decisions.md` (A0–A34). Progress log: `docs/assets-progress.md`.

Security and money first: §6 (security findings) and §7 (bugs) list them in order of impact.

---------------------------------------------------------------------------------------------------------------------

## 1. Inventory, claims, existing storage usage and rules

Full detail: `docs/assets-inventory.md` (written before any change). Summary with the scenario that covers each item:

| Area | What the original code did | Now | Scenario |
|---|---|---|---|
| Upload | No bytes were ever stored. The dialog called `POST /assets/upload-url` and PUT to a route that did not exist, then created a row with the client's `storageUrl`, `fileSize`, `checksum` | Streamed multipart → backend → S3 (busboy → lib-storage), magic-byte check, byte count, SHA-256 | T, U, D (baseline `00-baseline.txt` BL-T) |
| Sizes / keys | Client-declared `fileSize`, `storageKey`, `checksum` trusted (an Org B key was accepted) | Size, key, checksum come only from the server; key `orgs/{org}/assets/{asset}/v{n}/{random}` | AG, AE (BL-AG) |
| Quota | Hard-coded "50 GB", nothing enforced | 3 GB per organization (DB column), reservation + atomic conditional UPDATE, 413 / 411 / 429 | G–R |
| Portal | Listed drafts, private, other-program and deleted assets; download links empty; tier/segment bundles visible to everyone; fake "Download Brand Kit (.ZIP)" | Access rules in pure functions (`asset-access.ts`), signed downloads, real streamed ZIP, locked bundles | AA, AB, AC, AD (BL-AA, AB unit) |
| Logos / avatars | Base64 data URL → Cloudinary (secrets in `.env.example`) | Multipart → StorageService (not counted; `GET /api/v1/media/:id` → 302 signed URL) | A, AG3, AN |
| Trash / versions | Delete = soft delete forever; no version delete; restore via new version | 30-day trash still counted, permanent delete frees at once, version delete frees space | L, M |
| Bundles | API only, no admin UI; deleting a file broke the whole bundle (404) | Admin Bundles tab (CRUD, visibility, tier, affiliates, dates, items, publish, ZIP); unavailable items flagged | Z, Y |
| UI claims | UC1–UC15 in the inventory (50 GB, Enterprise Plan, Managed CDN, fake ZIP, "Copy Shareable" permanent URL…) | Removed or made true | AN, G |

Every place that stores, reads or deletes files (inventory §4) now goes through `StorageService`, except: the
development e-mail provider (writes rendered e-mails to `scratch/`, not user files — exempt in the lint rule), and
tax certificates (`affiliate_tax_certificates.fileUrl`, a client-supplied URL — billing/tax scope, decision A26,
listed in §9). No billing or coupon code was changed.

Rules from the code (inventory §5) and what happened to them: the extension-only check became a content check (U);
the 200 MB per-file limit is kept (A6) and enforced on real bytes (J); folders stay flat names (A33, W); tags,
versions and bundle items keep their tables; the bundle visibility rules were rewritten so PARTNER_TIER and
AFFILIATE_SEGMENT are no longer visible to everyone (AB, A10).

## 2. The storage service

`src/common/storage/` — a `@Global()` `StorageModule` exporting the abstract `StorageService`:

| Operation | Notes |
|---|---|
| `uploadStream({key, body, originalFileName, maxBytes, allowedTypes, organizationId, signal})` | Body piped through an inspector (magic bytes → type decision before anything is sent, byte counter that aborts at `maxBytes`, SHA-256), then lib-storage `Upload` (8 MB parts × queue 2); `headObject` size check after; on any failure the multipart upload is aborted and the object deleted |
| `getDownloadUrl(key, {fileName, contentType, disposition})` | 5-minute signed GET (`STORAGE_DOWNLOAD_URL_TTL_SECONDS`), `ResponseContentDisposition` with the user's file name; `inline` only for raster images, everything else (incl. SVG/HTML, which are refused anyway) `attachment` |
| `getObjectStream`, `headObject`, `deleteObject`, `deleteObjects`, `copyObject`, `listObjects(orgId?)` | used by downloads, ZIP, purge, reconciliation, migration |
| `putGeneratedObject` | thumbnails only (sharp, metadata stripped) |
| `ensureBucketSettings` / `describeBucketSettings` | Block Public Access, SSE (AES256 or KMS), abort-incomplete-multipart lifecycle; describe includes an anonymous read probe |

- **One provider** (`providers/s3-storage.provider.ts`), AWS SDK v3, one client per process, retries for transient
  errors in one place (`STORAGE_RETRY_MAX_ATTEMPTS`), every SDK error mapped to an app error (404 / 503 / 504 / 413 /
  415 / 400 / 502), logs `op= org= key= result=` without credentials or signed URLs (C checks the log).
- **One typed config** (`storage.config.ts`), validated at startup; a bad value stops the app with a message naming
  the variable (B: 11 cases + a real start). All variables are in `.env.example`; no credentials committed.
- **One key builder** (`storage-keys.ts`); the user's file name is never in a key (T checks every type).
- **One place only**: ESLint `no-restricted-imports` / `no-restricted-properties` / `no-restricted-syntax` forbid
  `@aws-sdk/*`, `@smithy/*` and fs writes outside `src/common/storage` (`npm run lint:architecture`), plus
  `test/unit/storage-architecture.spec.ts` (A).
- Bucket settings as code: `npm run storage:setup` / `storage:describe`; AWS CLI equivalents and the MinIO notes are in
  `docs/storage-setup.md`. No S3 versioning (C).
- Body limits and timeouts: uploads bypass the JSON body parser (multipart stream); the HTTP server's request timeout
  is `STORAGE_UPLOAD_TIMEOUT_MS + 60 s`; no API reverse proxy exists in the repos (FE `docker/nginx.conf` serves static
  files only) — `docs/storage-setup.md` lists the proxy settings to use if one is added.
- Existing files: `npm run storage:migrate-legacy` (dry run by default; F).

### How to change storage later

1. Another S3-compatible service (R2, Wasabi, MinIO): only `STORAGE_ENDPOINT`, `STORAGE_REGION`, keys,
   `STORAGE_FORCE_PATH_STYLE`. No code change.
2. A different provider (GCS, Azure Blob): add `providers/<name>-storage.provider.ts` implementing `StorageService`,
   add the provider name to `STORAGE_PROVIDER` validation and to `createStorageService()` in `storage.module.ts`.
   Nothing outside `src/common/storage` changes (the lint rule guarantees no feature talks to S3 directly).
3. Keys: change `storage-keys.ts` only; old keys keep working because rows store the full key.
4. Limits and timeouts: environment variables (table in `docs/storage-setup.md`).
5. Move existing objects between buckets/providers: `listObjects` + `copyObject` (the migration script is the template).

## 3. How the 3 GB limit was built

- Tables (migration `2026100400000_StorageQuota`, reversible — `down` refuses to drop non-empty tables):
  `organization_storage` (limit, used, reserved, activeUploads), `storage_reservations`, `stored_objects` (one row per
  object: kind, size, SHA-256, countsTowardQuota), `storage_deletion_queue`. TypeORM repositories only; `store.ts` not
  edited (A7).
- Default limit `STORAGE_DEFAULT_ORG_LIMIT_BYTES=3221225472`, shown as "3 GB"; per organization in the database;
  only platform admins change it (`PATCH /api/v1/admin/storage/organizations/:id/limit`, audited) (P).
- Upload: size to reserve = `min(X-File-Size, Content-Length)` (A18); one conditional UPDATE
  `used + reserved + n ≤ limit AND activeUploads < 5` reserves space and an upload slot (I, K); 413 with
  `details {neededBytes, availableBytes, limitBytes, usedBytes, reservedBytes, howToFree}`, 411 without any size,
  429 above 5 concurrent uploads; the stream is aborted beyond the reservation (J); the real size is committed in the
  same transaction as `stored_objects` + `assets`/`asset_versions` + the audit row; failures release everything (E).
- Counted: originals and older versions. Not counted: thumbnails, logos, avatars. A file in several bundles counts
  once; bundles and ZIPs use nothing (N). Trash counts until permanent deletion or the 30-day purge (L).
- Jobs (`storage-jobs.service.ts`, also runnable by platform admins): release reservations older than 60 min, purge
  expired trash, process the deletion queue, reconcile (counter = sum of records; orphans / missing objects / size
  mismatches reported, never auto-deleted — A27) (Q).
- Over the limit: uploads refused, everything else works, nothing deleted automatically (O).
- UI: storage bar "X of 3 GB used" with files / older versions / trash, warnings at 80 % and 95 %, pre-check in the
  upload and version dialogs, the 413 numbers and how to free space, storage-full state with the upload button
  disabled; numbers equal the database (G-ui, O-ui).

Commits (BE): 6482759 (module, tables, lint), 51b41fe (features on StorageService, quota, jobs, portal rules),
8e9529b (min reservation, 413 details), da9337f (migration), and the fixes in §7. FE a981fdf, AP d12b936.

## 4. Results

Final full run: `docs/assets-proof/suites/e2e-assets-full-run.txt` (Playwright, 45 tests in specs 01–08: **45 passed**).
API = HTTP checks, DB = SQL, S3 = independent MinIO client, UI = browser, Refresh = full page reload.

| # | Scenario | API | DB | S3 | UI | Refresh | Result |
|---|---|---|---|---|---|---|---|
| A | one place only | — | — | — | — | — | PASS (lint + test + greps) |
| B | config validation | ✓ | — | — | — | — | PASS (11 cases + real start) |
| C | bucket security | ✓ | ✓ | ✓ | — | — | PASS (Public Access Block API: see §9) |
| D | streaming memory | ✓ | ✓ | ✓ | — | — | PASS |
| E | failure cleanup (kill, storage down, late cancel, DB lock) | ✓ | ✓ | ✓ | — | — | PASS after 2 fixes |
| F | existing-file migration | ✓ | ✓ | ✓ | — | ✓ (restart) | PASS after fix |
| G | usage display | ✓ | ✓ | ✓ | ✓ | ✓ | PASS |
| H | exact boundary (10 MB + real 3 GB) | ✓ | ✓ | ✓ | — | — | PASS after fix |
| I | concurrent uploads | ✓ | ✓ | ✓ | — | — | PASS |
| J | wrong declared size | ✓ | ✓ | ✓ | — | — | PASS after fix |
| K | concurrency limit | ✓ | ✓ | — | — | — | PASS |
| L | trash | ✓ | ✓ | ✓ | ✓ | ✓ | PASS |
| M | versions | ✓ | ✓ | ✓ | — | — | PASS after fix |
| N | bundles don't double-count | ✓ | ✓ | ✓ | — | — | PASS after fix |
| O | over-limit organization | ✓ | ✓ | ✓ | ✓ | ✓ | PASS |
| P | who can change the limit | ✓ | ✓ | — | — | — | PASS |
| Q | reconciliation | ✓ | ✓ | ✓ | — | — | PASS after fix |
| R | usage isolation | ✓ | ✓ | ✓ | — | — | PASS |
| S | page load | ✓ | — | — | ✓ | ✓ | PASS (asset calls 1× each; app-shell duplicates §9) |
| T | upload every type | ✓ | ✓ | ✓ | ✓ | ✓ | PASS (15 types) |
| U | file type safety | ✓ | ✓ | ✓ | — | — | PASS after fix |
| V | bombs, huge dimensions, EXIF | ✓ | ✓ | ✓ | — | — | PASS |
| W | search, filters, sort, pagination | ✓ | — | — | ✓ | — | PASS |
| X | edit, rename, move, replace | ✓ | ✓ | — | — | — | PASS |
| Y | delete an asset that is in bundles | ✓ | ✓ | ✓ | — | — | PASS |
| Z | bundles CRUD | ✓ | ✓ | — | ✓ | ✓ | PASS after fix (N) |
| AA | who can see a bundle | ✓ | — | — | — | — | PASS |
| AB | tier-locked bundles | ✓ | — | — | ✓ | — | PASS |
| AC | ZIP | ✓ | — | ✓ | ✓ | — | PASS |
| AD | download links | ✓ | — | ✓ | ✓ | — | PASS |
| AE | organization isolation | ✓ | ✓ | ✓ | — | — | PASS after fix |
| AF | permissions table | ✓ | — | — | ✓ (nav) | — | PASS (20 actions × 5 roles) |
| AG | bad input / extra fields (+ AG3 avatars) | ✓ | ✓ | — | — | — | PASS after fix |
| AH | rejected requests leave nothing | ✓ | ✓ | ✓ | — | — | PASS |
| AI | database write failure | ✓ | ✓ | — | — | — | PASS |
| AJ | download counts | ✓ | ✓ | — | — | — | PASS |
| AK | cancel, close, errors, empty state | — | ✓ | — | ✓ | ✓ | PASS after fix |
| AL | audit log | ✓ | ✓ | — | — | — | PASS |
| AM | 20k assets, 1k bundles | ✓ | ✓ | — | ✓ | — | PASS after fix |
| AN | UI claims | — | — | — | ✓ | — | PASS |

## 5. Boundary, concurrency and memory numbers

- **D** — 199 MB upload: backend RSS 244 → peak 311 MB (+66 MB; parts 8 MB × 2 + stream buffers), 1.8 s, 112 MB/s
  to MinIO on localhost. A buffering implementation would grow by ≥ 199 MB.
- **H** — 10 MB limit: a file of exactly 10,485,760 bytes fits, then 1 byte → 413 `availableBytes: 0` (refused
  before the body is read); limit − 1 byte fits, then 2 bytes → 413, 1 byte → 201. Without `X-File-Size` the
  multipart framing is reserved too, so an exactly-full file is refused (the apps always send the header, A18).
  **Real 3 GB**: 15 × 200 MB + 72 MB = 3,221,225,472 bytes in API, MySQL and MinIO; the next byte → 413 "… of your
  3 GB is left" (`H-3GB.txt`).
- **I** — four 3 MB uploads at once into 10 MB: 3 × 201, 1 × 413, used 9 MB, nothing reserved afterwards; then
  twenty 1 MB uploads for the last 1 MB (five at a time): exactly one 201, nineteen 413/429; used = limit = S3 total.
- **J** — declared 1 MB / sent 3 MB → 413 at the reservation, nothing stored; declared 5 MB / sent 1 MB → 201 with
  1 MB counted; declared 300 MB with a 300 MB body → 413 after < 50 MB sent; unsafe or malformed headers → 400.
- **K** — five slow uploads in progress → the sixth gets 429 `TOO_MANY_CONCURRENT_UPLOADS`; all five finish 201.
- **AC** — ZIP of 4 × 45 MB (188,744,142 bytes) streamed in 0.4 s, backend RSS growth 0–35 MB across runs,
  `unzip -t`: no errors; duplicate names become `same.txt`, `same (2).txt`; the affiliate ZIP leaves out drafts.
- **AM** — 20,003 assets / 1,003 bundles: list page 1 137 ms, page 400 134 ms, search 215 ms, filters 45–138 ms,
  bundle list 54 ms (was 4,732 ms), portal assets 277 ms (was > 120 s with the API frozen), portal bundles 202 ms,
  admin page ready 1.1 s with "Page 1 of 417".

## 6. Security findings (C, U, V, AB, AD, AE first)

1. **No storage at all, client-trusted metadata (BL-T, BL-AG)** — the original upload never stored bytes and accepted
   a client `storageKey` pointing into another organization's prefix, any `fileSize` and `checksum`. Fixed by the
   storage service (51b41fe); AG/AE prove the fields are refused and keys never cross organizations.
2. **Portal leaks (BL-AA, AB unit)** — drafts, private, other-program and deleted assets were listed; PARTNER_TIER and
   AFFILIATE_SEGMENT bundles were visible to every affiliate. Fixed (51b41fe); AA/AB/AE verify, including
   "most restrictive wins" for a public file inside a locked bundle (A9) and tiers compared only within one program (A8).
3. **ZIP renamed to .docx/.pptx (U)** — an archive carrying `payload.exe` uploaded as `report.docx` was stored and
   offered as a Word file. Fixed in fd2a84f (OOXML must have `[Content_Types].xml` first).
4. **Avatar URL injection (AG3)** — `PATCH /affiliate/me/profile` stored any `avatarUrl` (`https://evil…/track.gif`,
   `javascript:`). Fixed in 38248ff (only the user's own stored image or null).
5. **Bulk action across organizations (AE)** — an Org B id in Org A's bulk request returned success and a mixed
   request half-applied. Fixed in a68826e (all or nothing, 404 with the missing ids). No Org B data was ever changed.
6. **Availability (AM)** — one portal request for a 20k-asset organization blocked the event loop for minutes (the whole
   API stopped answering). Fixed in d03416e.
7. **C** — bucket private (anonymous GET and LIST → 403), SSE AES256 on every object, signed links 5 minutes,
   tampering with the disposition or the key → 403, no signed URL or secret in the log. MinIO has no Public Access
   Block API (A5): the setting is applied by `storage:setup` on AWS but could not be read back here (§9).
8. **V** — a 30,000 × 30,000 PNG (109 KB) is stored but never decoded (thumbnail refused at the 40 M pixel limit;
   RSS unchanged); GPS EXIF is kept byte-exact in the original (A16, review) and absent from the thumbnail.
9. **AD** — links expire (TTL 2 s run: 200 then 403 `AccessDenied` after 3.5 s), are bound to the object, and are not
   issued for trashed files, other organizations or unknown ids (404).
10. **Not fixed, outside this audit, review first:** `PATCH /affiliate/me/profile` changes the **password without the
    current password** (`affiliate-portal.controller.ts`, `body.password`) — anyone holding an access token can lock the
    partner out. Old Cloudinary credentials remain in git history (removed from `.env.example`): **rotate them**.
11. **My own slip, handled:** two proof files committed on this branch (5925aae, pushed; 836ce66) contained expired
    signed thumbnail URLs whose `X-Amz-Credential` held the access key **ID** of the local test MinIO user (no secret
    key, the MinIO runs only inside this test container). The proof writer now redacts credential, signature and token
    values, all proof files were redacted, and the MinIO user was replaced (old user deleted, new credentials only in
    the git-ignored `.env`). History was not rewritten (no force-push).

## 7. Bugs (failing test first → fix → rerun; `git show --stat` below)

| # | Bug | Failing proof | Fix |
|---|---|---|---|
| 1 | Uploads stored nothing; client size/key/checksum trusted; portal leaks; tier/segment bundles public (baseline) | `baseline/00-baseline.txt`, `baseline/AB-unit-before-fix.txt` | BE 6482759 + 51b41fe, FE a981fdf, AP d12b936 |
| 2 | Storage outage during upload reported as the client's fault (400) | `baseline/E-storage-outage-before-fix.txt` | BE da4d5b9 |
| 3 | Version list said `hasFile: true` for a key of another organization | `baseline/F-version-hasFile-before-fix.txt` | BE ec5b807 |
| 4 | Reconciliation set the counter from the bucket listing (drift once a broken record is deleted) | `baseline/Q-reconcile-before-fix.txt` | BE 49f7027 |
| 5 | A deleted bundle blocked its name forever (409) | `baseline/N-bundle-name-reuse-before-fix.txt` | BE df3b6b4 |
| 6 | A new version could change the file type (UI promises the same type) | `baseline/M-version-type-before-fix.txt` | BE 5925aae |
| 7 | `X-File-Size` above 2^53 accepted (precision loss) | `baseline/J-unsafe-size-before-fix.txt` | BE 5925aae |
| 8 | ZIP renamed to .docx/.pptx accepted (security) | `baseline/U-sniffer-unit-before-fix.txt`, `baseline/U-docx-zip-before-fix.txt` | BE fd2a84f |
| 9 | Bulk action skipped foreign/unknown ids and reported success | `baseline/AE-bulk-foreign-ids-before-fix.txt` | BE a68826e |
| 10 | Client-supplied avatar URL stored (security) | `baseline/AG3-avatar-url-before-fix.txt` | BE 38248ff |
| 11 | Portal list froze the API with 20k assets; bundle list 4.7 s | `baseline/AM-large-before-fix.txt` | BE d03416e |
| 12 | 413 message "3.0 GB" vs storage bar "3 GB" | `baseline/H-format-unit-before-fix.txt`, `baseline/H-3GB-message-before-fix.txt` | BE 1e2c076 |
| 13 | Cancelled upload still saved and counted when the body had already arrived | `baseline/AK-cancel-before-fix.txt`, `baseline/E4-late-cancel-before-fix.txt` | BE 9abf1d0; FE fa06695 |

Each fix was re-run (scenario file without `baseline/`), and DB, S3 and (where the scenario has a UI) the screen after a
refresh were checked again in the final full run.

```
$ git show --stat --format='%h %s' 51b41fe
51b41fe feat(assets): real file storage through StorageService, 3 GB per-organization limit, portal access rules
 .env.example                                       |   31 +-
 docker-compose.env.example                         |   13 +-
 docker-compose.yml                                 |   19 +-
 docs/storage-setup.md                              |   90 ++
 e2e-assets/lib/upload.ts                           |  146 +++
 server.ts                                          |    5 +
 src/AppModule.ts                                   |    2 +
 src/bootstrap.ts                                   |    8 +
 src/common/storage/storage.config.ts               |    5 +
 .../affiliates/affiliate-portal.controller.ts      |   61 +-
 .../affiliate-assets.controller.ts                 |   87 ++
 .../asset-management/affiliate-assets.service.ts   |  288 ++++
 src/modules/asset-management/asset-access.ts       |  145 ++
 .../asset-management/asset-bundles.service.ts      |  249 ++++
 src/modules/asset-management/asset-common.ts       |  145 ++
 .../asset-management.controller.ts                 |  250 ++--
 .../asset-management/asset-management.module.ts    |   13 +-
 .../asset-management/asset-management.service.ts   | 1382 +++++++-------------
 .../asset-management/asset-thumbnail.service.ts    |   86 ++
 .../asset-management/asset-upload.service.ts       |  277 ++++
 .../asset-management/dto/asset-management.dto.ts   |  417 ++++--
 .../asset-management/storage-admin.controller.ts   |   49 +
 .../asset-management/storage-jobs.service.ts       |  193 +++
 src/modules/media/dto/media.dto.ts                 |   25 +-
 src/modules/media/media.controller.ts              |   40 +-
 src/modules/media/media.module.ts                  |    4 +-
 src/modules/media/media.service.ts                 |  176 ++-
 src/modules/storage-quota/storage-quota.module.ts  |    8 +
 src/modules/storage-quota/storage-quota.service.ts |  320 +++++
 src/tests/run-tests.ts                             |   28 +-
 test/unit/asset-bundle-access.spec.ts              |  121 +-
 32 files changed, 3395 insertions(+), 1296 deletions(-)

$ git show --stat --format='%h %s' da4d5b9
da4d5b9 Fix: storage outage during an upload was reported as the client's fault (400)
 .../baseline/E-storage-outage-before-fix.txt       |  20 ++
 e2e-assets/lib/assets.ts                           | 111 ++++++++++
 e2e-assets/scripts/minio.sh                        |  15 ++
 e2e-assets/tests/01-storage-core.spec.ts           | 244 +++++++++++++++++++++
 .../storage/providers/s3-storage.provider.ts       |  16 +-
 10 files changed, 567 insertions(+), 2 deletions(-)

$ git show --stat --format='%h %s' ec5b807
ec5b807 Fix: version list said hasFile=true for a version whose key belongs to another organization
 src/modules/asset-management/asset-management.service.ts | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

$ git show --stat --format='%h %s' 49f7027
49f7027 Fix: reconciliation set the counter from the bucket listing, not from the records
 src/modules/asset-management/storage-jobs.service.ts  | 12 ++++++++----
 2 files changed, 24 insertions(+), 4 deletions(-)

$ git show --stat --format='%h %s' df3b6b4
df3b6b4 Fix: a deleted bundle blocked its name forever (409 ASSET_BUNDLE_SLUG_EXISTS)
 .../baseline/N-bundle-name-reuse-before-fix.txt    | 19 ++++++++++++++
 .../asset-management/asset-bundles.service.ts      | 29 ++++++++++++++++------
 2 files changed, 41 insertions(+), 7 deletions(-)

$ git show --stat --format='%h %s' 5925aae
5925aae Fix: a new version could change the file type; X-File-Size above 2^53 was accepted
 .../baseline/J-unsafe-size-before-fix.txt          | 64 ++++++++++++++++++++++
 .../baseline/M-version-type-before-fix.txt         | 42 ++++++++++++++
 .../asset-management/asset-upload.service.ts       | 16 +++++-
 3 files changed, 120 insertions(+), 2 deletions(-)

$ git show --stat --format='%h %s' fd2a84f
fd2a84f Fix (security): any ZIP renamed to .docx/.pptx was accepted as an Office file
 .../baseline/U-docx-zip-before-fix.txt             | 31 ++++++++++++++++++++
 .../baseline/U-sniffer-unit-before-fix.txt         | 25 ++++++++++++++++
 src/common/storage/content-sniffer.ts              |  5 +++-
 test/unit/content-sniffer.spec.ts                  | 33 ++++++++++++++++++++++
 5 files changed, 94 insertions(+), 1 deletion(-)

$ git show --stat --format='%h %s' a68826e
a68826e Fix: bulk actions skipped unknown / other-organization ids and still reported success
 .../baseline/AE-bulk-foreign-ids-before-fix.txt    | 39 ++++++++++++++++++++++
 .../asset-management/asset-management.service.ts   | 33 +++++++++---------
 2 files changed, 57 insertions(+), 15 deletions(-)

$ git show --stat --format='%h %s' 38248ff
38248ff Fix (security): PATCH /affiliate/me/profile stored any client-supplied avatarUrl
 .../baseline/AG3-avatar-url-before-fix.txt         |   5 +
 e2e-assets/tests/06-security.spec.ts               |  26 +++++
 .../affiliates/affiliate-portal.controller.ts      |  13 ++-
 12 files changed, 224 insertions(+), 147 deletions(-)

$ git show --stat --format='%h %s' d03416e
d03416e Fix (availability): one portal request froze the API for minutes with 20k assets; bundle list 4.7 s
 e2e-assets/tests/08-large.spec.ts                  | 170 +++++++++++++++++++++
 .../affiliate-assets.controller.ts                 |  23 ++-
 .../asset-management/affiliate-assets.service.ts   |  77 +++++++---
 .../asset-management/asset-bundles.service.ts      |  35 ++++-
 6 files changed, 334 insertions(+), 26 deletions(-)

$ git show --stat --format='%h %s' 1e2c076
1e2c076 Fix: the 413 message said '3.0 GB' while the storage bar says '3 GB'; decisions A27-A34
 .../assets-proof/baseline/H-3GB-message-before-fix.txt | 18 ++++++++++++++++++
 .../assets-proof/baseline/H-format-unit-before-fix.txt |  3 +++
 docs/decisions.md                                      |  8 ++++++++
 src/modules/storage-quota/storage-quota.service.ts     |  5 ++++-
 test/unit/storage-format.spec.ts                       | 14 ++++++++++++++
 7 files changed, 66 insertions(+), 1 deletion(-)

$ git show --stat --format='%h %s' 9abf1d0
9abf1d0 Fix: a cancelled upload was still saved and counted when the body had already arrived
 .../assets-proof/baseline/AK-cancel-before-fix.txt | 15 ++++++++
 .../baseline/E4-late-cancel-before-fix.txt         | 35 ++++++++++++++++++
 e2e-assets/lib/upload.ts                           |  6 ++++
 e2e-assets/tests/01-storage-core.spec.ts           | 13 +++++++
 .../asset-management/asset-upload.service.ts       | 10 +++++-
 7 files changed, 134 insertions(+), 10 deletions(-)

(partner-iq-frontend)
$ git show --stat --format='%h %s' a981fdf
a981fdf Assets: real storage usage, streamed uploads, trash, bundles UI, server-side list
 src/components/assets/assets-bento-overview.tsx    |  29 +-
 src/components/assets/assets-browser-section.tsx   | 129 ++++--
 src/components/assets/assets-bundles-section.tsx   | 512 +++++++++++++++++++++
 src/components/assets/assets-header.tsx            |  33 +-
 src/components/assets/assets-storage-section.tsx   |  14 +-
 src/components/assets/assets-tabs.tsx              |   6 +
 src/components/assets/assets-trash-section.tsx     | 170 +++++++
 .../assets/dialogs/asset-detail-sheet.tsx          | 204 ++++----
 .../assets/dialogs/asset-upload-dialog.tsx         | 468 +++++++++----------
 .../assets/dialogs/asset-version-dialog.tsx        | 229 ++++-----
 src/components/assets/dialogs/folder-dialog.tsx    |   2 +-
 src/components/assets/storage-usage-bar.tsx        | 119 +++++
 src/components/pages/assets/asset-library-view.tsx | 365 +++++++++------
 src/components/pages/branding/branding-view.tsx    |  19 +-
 .../programs/form/program-branding-section.tsx     |  24 +-
 src/lib/api/asset-management.ts                    | 144 +++++-
 src/lib/api/client.ts                              |  66 +++
 src/lib/api/media.ts                               |  30 +-
 src/lib/auth/role-access.ts                        |  41 +-
 src/lib/format/storage.test.ts                     |  21 +
 src/lib/format/storage.ts                          |  24 +
 21 files changed, 1923 insertions(+), 726 deletions(-)

$ git show --stat --format='%h %s' fa06695
fa06695 Assets UI: after a cancelled upload, reload list and storage from the server
 src/components/assets/dialogs/asset-upload-dialog.tsx  | 9 +++++++--
 src/components/assets/dialogs/asset-version-dialog.tsx | 9 +++++++--
 src/components/pages/assets/asset-library-view.tsx     | 2 ++
 3 files changed, 16 insertions(+), 4 deletions(-)

(partner-iq-affiliate-portal)
$ git show --stat --format='%h %s' d12b936
d12b936 Assets: signed downloads, bundles with locked state, real ZIP, multipart avatar
 src/components/views/AffiliateBundlesPanel.tsx | 146 ++++++++++++++++++++++++
 src/components/views/MarketingAssetsView.tsx   | 147 ++++++++++++++-----------
 src/lib/api/assets.ts                          |  32 +++++-
 src/lib/api/profile.ts                         |  22 ++--
 src/lib/client.ts                              |  42 +++++++
 src/types.ts                                   |  56 +++++++++-
 6 files changed, 355 insertions(+), 90 deletions(-)
```
(proof files under docs/assets-proof/ are left out of the listings above)

## 8. Decisions

All in `docs/decisions.md` (question, decision, why, commit). The ones to review first:

- A6 keep the 200 MB per-file limit · A13 logos/avatars not counted, served through a redirect, old logos never cleaned
  up (growth) · A15 five concurrent uploads per organization · A16 EXIF/GPS kept in originals · A17 no malware scanning
  · A18 reserve `min(X-File-Size, Content-Length)` · A25 legacy files migrated only from allowlisted hosts · A26 tax
  certificates untouched · A27 counter = sum of records · A28 versions keep the file type · A29 portal list capped at
  500 per page · A31 bulk all-or-nothing · A33 flat folders.

## 9. BLOCKED and not tested

**BLOCKED**
- Real AWS S3: no AWS account in this environment. Public Access Block, the abort-incomplete-multipart lifecycle rule
  and KMS keys were applied by code that MinIO does not support (A5): MinIO returns `NotImplemented` for
  PublicAccessBlock and rejects a lifecycle rule without an expiration. Worked around by proving the effect (anonymous
  403, stale multipart uploads expired by MinIO + the app's cleanup job). Run `npm run storage:setup` and
  `npm run storage:describe` once against the real bucket.
- Migration of real Cloudinary files: no access to the production Cloudinary account; tested with a local HTTP host.

**Not tested**
- `STORAGE_ENCRYPTION=aws:kms` and `STORAGE_USE_IAM_ROLE=true` (code paths exist, no AWS).
- Two or more backend instances at once (the reservation is one conditional UPDATE in MySQL, so it should hold, but
  only one instance ran here).
- Malware scanning (none exists, A17); browsers other than Chromium; mobile layouts; very slow real networks.
- The serverless entry `api/index.ts` (unsuitable for 200 MB streamed uploads; not used by the Docker deployment).
- A paging UI in the portal (the API pages, the portal shows the newest 500 — A29).

**Found, outside this audit (reported, not changed)**
- Password change without the current password (`PATCH /affiliate/me/profile`) — security, review first.
- App shell: every admin page loads `members` 6× and programs/affiliates/links/… 2× (S proof); the refresh-token race
  from the coupons audit (logged in `assets-proof/auth-reload-race.txt` when it happens).
- Gamification `PATCH /partner-tiers/:id` needs the whole tier body (partial update → 400).
- Milestone reward `ACCESS_TO_ASSET_BUNDLE` is never granted (tier rewards via `rewardsConfig.assetBundleIds` do work, AB5).
- Platform-admin system-health text "AWS CloudFront + S3 Edge": no CloudFront exists.
- `resolveAffiliatesForUser` swallows errors (`catch {}`).
- The portal blocks every page until payout + tax + profile fields are complete (the AN test fills them for its test
  affiliate) — product decision, not a bug, but new partners cannot even look at marketing files first.
- Logo/banner/avatar uploads have the same late-cancel window as bug 13 (not counted toward the quota; not changed).
- A reverse proxy that does not forward the client's disconnect once it has the whole body (the vite dev/preview proxy
  behaves like this) lets a cancel that arrives at the very end go unnoticed by the backend; the file is then saved.
  The admin UI now reloads the list and the storage bar after every cancel (FE fa06695), so the screen
  shows what the server holds. For nginx keep `proxy_ignore_client_abort off` (the default).
- Backend unit suite: `demo-bookings.spec.ts` does not compile on main (constructor arguments); the jest
  `integration` project has no test files. Frontend `tsc`: 249 errors on main, none in files this branch changed.
- Leftover data from earlier runs, not touched: untracked `e2e/` (coupons audit harness) and `scratch/dev-emails/` in
  the backend checkout.

## 10. Conclusion

Verified in a test environment against test data: every file the apps store now goes through one `StorageService`
(streamed, type-checked, counted, checksummed, private, short signed links); each organization has a 3 GB limit
(per-organization value, platform-admin only) that holds at the exact byte, under concurrency, with lying clients and
across failures; trash, versions, bundles and ZIPs count the way they say; affiliates see only what their program,
tier and selection allow; and the admin and portal screens show the same numbers as the database. 13 bugs were found
and fixed with a failing test first, 5 of them security or availability issues.

Not tested: real AWS (Public Access Block, KMS, IAM role), real Cloudinary migration, multiple backend instances,
malware scanning, non-Chromium browsers — see §9, together with the out-of-scope findings that need review first
(password change without the current password; rotate the old Cloudinary credentials).
