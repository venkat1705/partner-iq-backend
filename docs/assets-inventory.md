# Assets & Bundles inventory (Part 1, written before any change)

Code read at: backend `main` = `1d2ec48`, admin frontend `main` = `54dc9e9`, affiliate portal `main` = `89314c3`.
Scenario letters refer to Part 4 of the task (A–AN). "dbStore" = the in-memory `DBBackedArray` store
(`src/database/store.ts`) that writes to MySQL in the background; "repo" = a TypeORM repository.

---------------------------------------------------------------------------------------------------------------------
## 1. UI inventory

### 1.1 Admin app — page "Assets & Bundles" (`src/components/pages/assets/asset-library-view.tsx`)

Opened from the sidebar entry **"Assets & Bundles"** (`app-layout.tsx:313`, page id `assets`). Roles: any member whose
role has `assets.view` (OWNER, ADMIN, PROGRAM_MANAGER, …; `permission-catalog.ts`). The UI does **not** hide any control
by permission (every button is shown to every role that can open the page). [AF]

On load (`loadAllData`, line 78) the page calls 6 GETs in parallel: `GET /assets?limit=100`, `GET /assets/folders`,
`GET /asset-analytics/storage`, `GET /asset-analytics/usage-intelligence`, `GET /asset-activity`, `GET /asset-analytics`.
Failures are only logged to the console; a toast appears only if assets, folders **and** storage all fail. [S, AK]

| Element | Opens / does | API | Changes data | Notes / scenario |
|---|---|---|---|---|
| Header **Sync** | reloads all 6 GETs | as above | no | S |
| Header **New Folder** | `FolderDialog` | none — folder is added to React state only | no (lost on refresh) | W, AK |
| Header **Upload Asset** | `AssetUploadDialog` | `POST /assets/upload-url`, `POST /assets` | yes | T |
| Header search "Search assets by title, tags, format, or folder..." | filters in the browser | none (client-side over the first 100 assets) | no | W |
| Header program select "All Affiliate Programs" | refetch with `programId` | `GET /assets?programId` | no | W |
| Header **Visual Grid / Data Table** | view toggle | none | no | — |
| Tabs: Overview, Assets, Folders, Usage, Storage & Analytics, Activity (`assets-tabs.tsx`) | switch view | none | no | — |
| Overview bento cards (`assets-bento-overview.tsx`): total assets, **Storage Allocation** "x% of 50 GB quota consumed", "Free quota available", "Content swipes & copies", "Engagement conversion", "Distribution posture", "Unused creatives" | read-only | from the 6 GETs | no | G, AJ |
| "Recently Uploaded & Updated Assets" (first 8) + "View All Library Assets →" | browser section | — | no | — |
| Browser section filters (`assets-browser-section.tsx:133-178`): Format, Status, Folder | client-side filter | none | no | W (no server-side filter used, no sort, no pagination) |
| Bulk bar: **Move to Folder**, **Add Tags**, **Archive** | `BulkActionDialog` → `POST /assets/bulk-action` | yes | X, L |
| Card/row actions: **Preview**, edit, new version, archive, download, copy | sheet / dialogs | see below | — | — |
| Table columns: Asset, Format, Folder, Program, Size, Version, Status, Usage, Actions | — | — | — | W |
| Empty state "No assets found" | — | — | — | AK |
| Loading: skeleton grid | — | — | — | — |
| Folders tab (`assets-folders-section.tsx`) | folder cards → filter | `GET /assets/folders` | no | W |
| Usage tab (`assets-usage-section.tsx`): most used, unused, bundle coverage, program distribution, "Total Storage" | read-only | usage-intelligence | no | AJ |
| Storage tab (`assets-storage-section.tsx`): "**Enterprise Plan Storage Utilization**" + badge "**Managed CDN**", "x of 50 GB quota allocated", "Available Free Quota", growth chart, category chart, largest assets | read-only | storage analytics | no | G |
| Activity tab (`assets-activity-section.tsx`): audit trail "immutable audit trail" | read-only | `GET /asset-activity` | no | AL |
| **Asset detail sheet** (`asset-detail-sheet.tsx`): preview (image `<img src=storageUrl>` / text), **Download**, **Copy Shareable**, **New Version**, **Edit**, Versions list with **Restore**, "Usage & Referrals", "Partner Visibility & Permissions", **Archive Asset** | drawer | `GET /assets/:id/versions`, `POST /assets/:id/restore/:versionId`, `GET /assets/:id/usage-references` | restore/archive yes | M, Y, AK |
| **Upload dialog** (`asset-upload-dialog.tsx`): source File / Copy-Text / External URL, file drop zone "PNG, JPG, SVG, MP4, PDF, DOCX (Max 200MB)", title, description, format, folder, program, tags, "Publish immediately…", "Allow affiliates to download raw file", **Cancel**, **Upload & Publish** | dialog | `POST /assets/upload-url` then `POST /assets` | yes | T, U, AK |
| **Version dialog** (`asset-version-dialog.tsx`): replacement file (optional), change notes, submit | dialog | `POST /assets/upload-url`, `POST /assets/:id/version` | yes | M, X |
| **Edit dialog** (`asset-edit-dialog.tsx`): title, description, folder, status (Published/Draft/Archived), program, tags, downloadable/copyable, **Save Changes** | dialog | `PATCH /assets/:id` | yes | X |
| Bulk action dialog: target folder / custom folder / tags, **Confirm & Apply** | dialog | `POST /assets/bulk-action` | yes | X |
| Folder dialog "New Creative Folder" | dialog | none | no | W |
| Download (`handleDownload`, line 206) | opens `asset.storageUrl` (whatever URL the client stored) in a new tab, or a text blob | none | no | AD |

**Bundles:** the nav label says "Assets & Bundles", but the admin app has **no bundle screen at all**. The API client
defines `listBundles`, `createBundle`, `addBundleAsset`, `publishBundle` (`lib/api/asset-management.ts:281-286`) and
nothing calls them. Bundles appear only as a count ("publishedBundles") in the overview and as a milestone reward option
"Unlock Asset Bundle" (`gamification/dialogs/milestone-form-dialog.tsx:221`). [Z, AA, AB]

### 1.2 Affiliate portal (`partner-iq-affiliate-portal`)

`MarketingAssetsView.tsx` (route `/assets`, sidebar "Marketing Assets"). Data: `GET /api/v1/affiliate/me/assets`
(`lib/api/assets.ts`), JWT only.

| Element | API | Notes / scenario |
|---|---|---|
| Asset cards: title, type, size, dimensions, **Preview HD**, **Download** (`<a href={asset.downloadUrl} download>`), **Copy Text**, **Copy Asset URL** | `/affiliate/me/assets` | `downloadUrl`/`previewUrl` come from `fileUrl`, which the `Asset` entity does not have → empty link (downloads cannot work); no signing, no permission check [AD] |
| **Download Brand Kit (.ZIP)** (line 290) | none — only shows the toast "Bundling N assets … into a ZIP package..." | **fake**: no ZIP is produced [AC] |
| Brand colors "Primary: #2563EB", "Accent: #9333EA" | hard-coded | not from the org |
| "FTC & ASCI Compliant: Disclose affiliate partnership" | static text | — |
| Affiliate Badge & Widget Generator (HTML snippets with unsplash images) | none | — |
| Asset modal: Dimensions, File Size, Placement, **Copy Asset URL**, **Download Asset** | — | — |
| Bundles | **none** — the portal has no bundle screen and calls no bundle API | AA, AB |
| Empty/loading/error | generic view loading; no specific asset error state | AK |

The org-scoped affiliate routes `GET /organizations/:id/affiliate/asset-bundles…` (backend) are behind
`OrganizationGuard` (membership required) and `assets.download`, so a portal affiliate (not an org member) cannot call
them; they are unused.

---------------------------------------------------------------------------------------------------------------------
## 2. UI claims

| # | Claim (verbatim) | Where | Code reality | Scenario |
|---|---|---|---|---|
| UC1 | "PNG, JPG, SVG, MP4, PDF, DOCX (Max 200MB)" | upload dialog | backend **blocks SVG** (`BLOCKED_EXTENSIONS`), max 200 MB checked only against the **client-declared** size; bytes are never uploaded | T, U, J |
| UC2 | "Upload graphics, videos, swipe copy, or whitepapers to distribute to partners." | upload dialog | no file bytes are ever sent anywhere ("Step 2: Use simulated local storage URL or mock upload", line 148) | T |
| UC3 | "Upload & Publish" / toast "Asset uploaded and published successfully" | upload dialog | only a database row is created; `storageUrl` = the fake upload URL | T |
| UC4 | "x% of 50 GB quota consumed", "Free quota available" | overview card | hard-coded `50 * 1024**3` in `getStorageAnalytics`; nothing enforces it; usage = sum of client-declared sizes | G, O |
| UC5 | "Enterprise Plan Storage Utilization", "Managed CDN" | storage tab | no plan link, no CDN, no storage | G |
| UC6 | "Allow affiliates to download raw file" | upload/edit | `isDownloadable` is checked only in the unused org-scoped affiliate route; the portal returns `fileUrl` for every asset | AD |
| UC7 | "Publish immediately to eligible affiliate partners" | upload | the portal list returns **all** assets incl. drafts and archived | AA, AE |
| UC8 | "Copy Shareable" | detail sheet | copies `storageUrl` (a permanent URL) | AD |
| UC9 | "immutable audit trail" | activity tab | audit rows written through dbStore (background), metadata without before/after for most actions | AL |
| UC10 | "Download Brand Kit (.ZIP)" / "Bundling N assets … into a ZIP package..." | portal | fake | AC |
| UC11 | "Assets & Bundles" (nav) | admin | no bundle UI | Z |
| UC12 | "Unlock Asset Bundle" (milestone reward), tier `rewardsConfig.assetBundleIds`, bundle visibility `PARTNER_TIER` | gamification / API | never enforced: `isBundleVisibleToAffiliate` returns **true** for `PARTNER_TIER` and `AFFILIATE_SEGMENT` | AB |
| UC13 | "Leave blank if only revising metadata or copy notes" | version dialog | a version with no file still bumps the version number | M |
| UC14 | "Restore" (versions) | detail sheet | creates a new version pointing at the old key (no copy) | M |
| UC15 | Admin "Tenant isolation: … S3 asset buckets utilize namespaced prefixes" (`admin/governance/tabs/tenant-isolation-tab.tsx:74`), system-health "S3 Asset & Document Storage", "AWS CloudFront + S3 Edge" | platform admin | **no S3 exists** in the code; text is fabricated | A, C |

No "unlimited storage" or "unlock at Gold tier" text exists for assets/bundles.

---------------------------------------------------------------------------------------------------------------------
## 3. API list (backend)

Controller `asset-management.controller.ts`, base `api/v1/organizations/:organizationId`, guards
`JwtAuthGuard, OrganizationGuard, PermissionsGuard`. Organization limit: `OrganizationGuard` (caller must be a member of
`:organizationId`) and every service lookup filters `dbStore.*` by `organizationId`. **All methods use dbStore; none
uses a TypeORM repository.**

| Method | Path | Permission | Service method | Storage | Scenarios |
|---|---|---|---|---|---|
| POST | `/assets/upload-url` | assets.create | `createUploadUrl` → fake URL `/api/v1/storage/local-upload/<key>` (**no such route exists**) | none | T, J |
| POST | `/assets` | assets.create | `createAsset` (trusts `fileSize`, `storageKey`, `storageUrl`, `checksum`, `mimeType` from the client) | dbStore | T, AG |
| GET | `/assets?page&limit&search&programId&assetType&status&language&country&folderPath&tag` | assets.view | `listAssets` (in-memory filter, sorted by updatedAt desc only) | dbStore | W, AM |
| GET | `/assets/folders` | assets.view | `listFolders` (5 default folders + derived) | dbStore | W |
| POST | `/assets/bulk-action` | assets.edit | `bulkAction` (ARCHIVE needs only `assets.edit`) | dbStore | X, AF |
| GET | `/assets/:assetId` | assets.view | `getAsset` | dbStore | AE |
| GET | `/assets/:assetId/usage-references` | assets.view | `getAssetUsageReferences` | dbStore | Y |
| PATCH | `/assets/:assetId` | assets.edit | `updateAsset` — `Object.assign(asset, dto)` (whatever the DTO allows) | dbStore | X, AG |
| DELETE | `/assets/:assetId` | assets.delete | `archiveAsset` (sets `deletedAt` + ARCHIVED; no trash, no restore, no permanent delete) | dbStore | L |
| POST | `/assets/:assetId/version` | assets.edit | `addVersion` (trusts client size/key) | dbStore | M |
| GET | `/assets/:assetId/versions` | assets.view | `listVersions` | dbStore | M |
| POST | `/assets/:assetId/restore/:versionId` | assets.edit | `restoreVersion` | dbStore | M |
| POST | `/asset-bundles` | assetBundles.create | `createBundle` | dbStore | Z |
| GET | `/asset-bundles` | assetBundles.view | `listBundles` | dbStore | Z, AM |
| GET | `/asset-bundles/:bundleId` | assetBundles.view | `getBundle` | dbStore | Z |
| PATCH | `/asset-bundles/:bundleId` | assetBundles.edit | `updateBundle` (`Object.assign`) | dbStore | Z, AG |
| DELETE | `/asset-bundles/:bundleId` | assetBundles.delete | `archiveBundle` | dbStore | Z |
| POST | `/asset-bundles/:bundleId/assets` | assetBundles.edit | `addBundleAsset` (no audit row) | dbStore | Z, AE |
| DELETE | `/asset-bundles/:bundleId/assets/:assetId` | assetBundles.edit | `removeBundleAsset` (splice; no audit) | dbStore | Z |
| PATCH | `/asset-bundles/:bundleId/reorder` | assetBundles.edit | `reorderBundleAssets` (no audit) | dbStore | Z |
| POST | `/asset-bundles/:bundleId/publish` | assetBundles.publish | `publishBundle` | dbStore | Z |
| POST | `/asset-bundles/:bundleId/archive` | assetBundles.publish | `archiveBundle` | dbStore | Z |
| GET | `/affiliate/assets` | assets.download | `listAffiliateAssets(user.affiliateId \|\| user.userId)` | dbStore | AA |
| GET | `/affiliate/asset-bundles` | assets.download | `listAffiliateBundles` | dbStore | AA, AB |
| GET | `/affiliate/asset-bundles/:bundleId` | assets.download | `getAffiliateBundle` | dbStore | AA, AB |
| POST | `/affiliate/assets/:assetId/activity` | assets.download | `recordActivity` (any activity type, no visibility check) | dbStore | AJ |
| GET | `/affiliate/assets/:assetId/download` | assets.download | `getDownloadUrl` — returns `asset.storageUrl` (permanent, client-supplied) or a fake URL; **no bundle/program visibility check** | dbStore | AD, AB |
| GET | `/asset-analytics` | assets.view | `analytics` | dbStore | AJ |
| GET | `/asset-analytics/storage` | assets.view | `getStorageAnalytics` (50 GB hard-coded) | dbStore | G |
| GET | `/asset-analytics/usage-intelligence` | assets.view | `getUsageIntelligence` (bundle items of **all orgs**: `dbStore.assetBundleItems` unfiltered) | dbStore | AE |
| GET | `/asset-activity` | assets.view | `getAssetActivity` | dbStore | AL |

Portal (`affiliates/affiliate-portal.controller.ts`):

| Method | Path | Auth | What it does | Storage | Scenarios |
|---|---|---|---|---|---|
| GET | `/api/v1/affiliate/me/assets?organizationId` | JWT | resolves the caller's affiliate rows, then **`assets.find({ where: { organizationId: In(orgIds) } })`** — every asset of the org incl. DRAFT, ARCHIVED, deleted, private, other programs', with `downloadUrl = fileUrl` | **TypeORM repo** | AA, AD, AE |
| POST | `/api/v1/affiliate/me/avatar` | JWT | base64 data URL → Cloudinary (`MediaService.uploadImage`) | Cloudinary | — |

Media (`media/media.controller.ts`): `POST /organizations/:id/media/images` (`manage.programs` / `assets.create` /
`workspace.manage` / `branding.update` / `organizations.update`) → `MediaService.uploadImage` → Cloudinary.

---------------------------------------------------------------------------------------------------------------------
## 4. Every place that stores, reads or deletes files today

| Repo | File:line | What | Moves to StorageService? |
|---|---|---|---|
| backend | `src/modules/media/media.service.ts:16-48` | `uploadImage`: base64 data URL (JSON body, 10 MB body limit) POSTed to `https://api.cloudinary.com/v1_1/{cloud}/image/upload`, folder `{CLOUDINARY_UPLOAD_FOLDER}/{orgId}/{purpose}`; returns public `secure_url` | yes |
| backend | `src/modules/media/media.service.ts:50-61` | env `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_FOLDER` | removed |
| backend | `src/modules/media/media.controller.ts:17-26` | `POST /organizations/:id/media/images` | yes |
| backend | `src/modules/affiliates/affiliate-portal.controller.ts:396-433` | `POST /affiliate/me/avatar` → `MediaService.uploadImage(purpose 'affiliate-avatar')`, stores `secureUrl` in `users.avatarUrl` | yes |
| backend | `src/modules/asset-management/asset-management.service.ts:935-958` | `LocalSignedStorageProvider`: builds `{orgId}/assets/{Date.now()}-{sanitizedFilename}` keys and **fake** URLs; stores nothing | replaced |
| backend | `src/modules/asset-management/asset-management.service.ts:41-59` | allowed/blocked extensions, `MAX_FILE_SIZE = 200 MB` | moved to storage config |
| backend | `src/modules/affiliates/affiliate-portal.controller.ts:1886-1919` | portal asset list maps `downloadUrl: a.fileUrl` — the `Asset` entity has **no `fileUrl` column**, so every portal download link is an empty string | replaced by signed links |
| backend | `src/modules/tax-certificates/tax-certificates.service.ts:596-615,698` | tax certificate "upload" stores a **client-supplied `fileUrl`**; download returns that URL; no file is stored by the app | yes (multipart upload through StorageService, private) |
| backend | `src/modules/email-design/providers/development-email.provider.ts:2,23,26` | dev-only email provider writes rendered email HTML to `scratch/dev-emails/` (`fs.mkdirSync`, `fs.writeFileSync`) | **no** — not an uploaded file; dev logging only (recorded in decisions) |
| backend | `src/bootstrap.ts:78,84` | `express.json({ limit: '10mb' })`, `urlencoded` 10 MB (base64 images travel through these) | uploads move to a streaming multipart route outside the JSON parser |
| backend | `docker-compose.yml` "Asset uploads (Cloudinary)" block | Cloudinary env vars | replaced by `STORAGE_*` |
| backend | `.env.example:89-92` | Cloudinary vars | replaced by `STORAGE_*` |
| backend | `src/modules/programs/dto/program.dto.ts:132,137` | example URLs `res.cloudinary.com` (logo/banner) | updated |
| backend | `src/database/schema.ts` columns `users.avatarUrl`, `organizations.logoUrl` (and branding `logoUrl`), `programs.logoUrl/bannerUrl` (lines 922-925), `affiliate_tax_certificates.fileUrl` (line 1077), `assets.storageKey/storageUrl/thumbnailUrl/previewUrl`, `asset_versions.storageKey/storageUrl` | URL/key columns | keys go through StorageService |
| backend | billing: `invoiceUrl` (`schema.ts:5105`), `pdfUrl` (`schema.ts:5994`) | billing documents (URLs only, no file I/O found) | **out of scope** (billing) — listed only |
| admin FE | `src/lib/api/media.ts:19-21` | `mediaApi.uploadImage` → `POST /media/images` with `dataUrl` | yes (multipart) |
| admin FE | `src/components/programs/form/program-branding-section.tsx:64-67,138,188` | `FileReader.readAsDataURL` → `mediaApi.uploadImage` (program logo/banner) | yes |
| admin FE | `src/components/pages/branding/branding-view.tsx:94` | org branding logo → `mediaApi.uploadImage` | yes |
| admin FE | `src/components/assets/dialogs/asset-upload-dialog.tsx:141-149` | `createUploadUrl` then **no upload** ("simulated … or mock upload") | yes |
| admin FE | `src/components/assets/dialogs/asset-version-dialog.tsx:66-74` | same pattern for versions | yes |
| admin FE | `src/components/pages/assets/asset-library-view.tsx:206-231` | download = open `storageUrl` | signed link |
| portal | `src/lib/api/profile.ts:61-74` | avatar: `readAsDataURL` → `POST /affiliate/me/avatar` | yes (multipart) |
| portal | `src/components/views/ProfileSecurityView.tsx:505` | avatar file input | — |
| portal | `src/components/views/MarketingAssetsView.tsx:239,661,761` | `<a href={asset.downloadUrl}>` | signed link |

No AWS/S3/GCS SDK, Multer config, local upload directory, bucket name or storage credential exists in any repo.
No frontend uploads directly to a storage service. No proxy body-size config exists (the frontend nginx config
`docker/nginx.conf` serves static files only; the API is called directly). `api/index.ts` wraps the app with
`serverless-http` (a serverless deployment would cap request bodies; recorded in decisions).

---------------------------------------------------------------------------------------------------------------------
## 5. Rules from the code

| Rule | Code | Scenario |
|---|---|---|
| Allowed extensions: jpg, jpeg, png, webp, gif, mp4, mov, webm, pdf, doc, docx, ppt, pptx, txt, csv; blocked: exe, dll, bat, cmd, com, js, mjs, ps1, sh, svg, html | `asset-management.service.ts:41-58`; extension only, no content check; MIME check only rejects `javascript`/`x-msdownload` | U |
| Max file size 200 MB, checked against the **declared** `fileSize` | `:59`, `validateFile` | J |
| Filenames: `/` `\` removed, other non `[a-zA-Z0-9._ -]` → `_`, cut at 180 chars | `sanitizeFileName` | V |
| Versions: every `addVersion` bumps `asset.version`, marks old versions `isCurrent=false`, copies key/size from the DTO; restore = new version with the old key; no version delete | `addVersion`, `restoreVersion` | M |
| Folders: `metadata.folderPath` string, default "General"; 5 default folder names always listed; no folder entity | `listFolders` | W |
| Tags: `simple-array` on the asset, also pushed to `asset_tags` | `normalizeTags` | W |
| Bundles reference assets through `asset_bundle_items` (bundleId, assetId, displayOrder, unique pair) | schema | Z |
| Bundle visibility: status PUBLISHED/SCHEDULED, date window, `programId` (affiliate must be ACTIVE in it), `PRIVATE` → hidden, `SPECIFIC_AFFILIATES` → `affiliateIds` list; **`PARTNER_TIER` and `AFFILIATE_SEGMENT` → visible to everyone** (`partnerTierId`/`affiliateSegmentId` never read) | `isBundleVisibleToAffiliate` | AA, AB |
| Asset delete = archive (`deletedAt`); bundle items keep pointing at it; `hydrateBundle` then calls `findAsset` which throws **404 for the whole bundle** (bundle breaks) | `archiveAsset`, `hydrateBundle` | Y |
| Download: no check of bundle visibility, program membership or tier | `getDownloadUrl` | AD, AB |

---------------------------------------------------------------------------------------------------------------------
## 6. Existing storage limits / usage counters

- Only `getStorageAnalytics` reports a "limit": hard-coded **50 GB**, usage = Σ client-declared `fileSize` of
  non-deleted assets (versions not counted). **Not enforced anywhere** on the server. No counter table exists.
- Per-file limit 200 MB checked against the declared size only; Cloudinary path limits images to 5 MB (estimated from
  base64 length).
- No per-organization concurrent-upload limit, no trash, no reservation.
