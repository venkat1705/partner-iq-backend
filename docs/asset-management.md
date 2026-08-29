# Automated Asset & Asset Bundle Library

PartnerIQ now includes a tenant-isolated partner enablement system for approved marketing assets, reusable asset bundles, affiliate self-service resources, personalization, versioning, activity analytics, and audit logging.

## Backend Surface

- Organization APIs live under `/api/v1/organizations/:organizationId/assets` and `/asset-bundles`.
- Affiliate portal APIs live under `/api/v1/organizations/:organizationId/affiliate/assets` and `/affiliate/asset-bundles`.
- All organization routes use `JwtAuthGuard`, `OrganizationGuard`, and `PermissionsGuard`.
- The service never trusts client-provided tenant ownership beyond the guarded route tenant.
- Asset, bundle, version, tag, activity, and favorite entities are registered with TypeORM and the DB-backed store.

## Security Model

Required flow:

`Authentication -> Tenant Resolution -> RBAC -> Resource Ownership -> Program Eligibility -> Bundle Visibility -> Signed Asset Access`

Implemented safeguards include extension blocking, filename sanitization, maximum file size validation, SVG/executable rejection, checksum duplicate detection, HTML sanitization, signed upload/download abstractions, soft archive behavior, idempotent activity recording, and cross-tenant lookup protection.

## Permissions

New permissions:

- `assets.view`, `assets.create`, `assets.edit`, `assets.delete`, `assets.publish`, `assets.download`
- `assetBundles.view`, `assetBundles.create`, `assetBundles.edit`, `assetBundles.delete`, `assetBundles.publish`

Owner and Admin retain full access. Program and Affiliate Managers can create/edit/publish resources. Analysts and Viewers get read-only marketing access.

## Frontend Surface

The app shell has a new Marketing navigation entry at `/app/assets`.

The screen includes:

- Asset library with search, filters, grid/list views, bulk selection, preview, copy, download, status badges, tags, usage counts, and demo fallback data.
- Upload/create modal for file, text, and URL assets with placeholder support.
- Bundle workspace with visibility, schedule, item ordering display, publish action, featured kit state, and reusable asset references.
- Affiliate portal preview with personalized copy, QR action, and quick resource cards.
- Analytics panel for top assets, engagement signals, and automation-ready inactive affiliate logic.

## Personalization

Shared assets can include placeholders such as:

- `{{affiliate_name}}`
- `{{affiliate_code}}`
- `{{affiliate_tracking_link}}`
- `{{program_name}}`
- `{{organization_name}}`
- `{{campaign_name}}`
- `{{coupon_code}}`

The backend resolves these at view/copy/download time without mutating the source asset.

## Verification

Run:

```bash
npm.cmd run lint
npm.cmd test
```

The integrated test suite covers tenant isolation, asset creation, version history, bundle publishing, affiliate visibility, activity idempotency, and analytics rollups.
