# Phase 2 — test users and data (raw SQL proof)

Created by `e2e/scripts/seed-fixtures.ts` through the real HTTP API (register → email OTP read from the dev email
provider's `email_delivery_logs.snapshotHtml` → session; `POST /organizations`; `POST /organizations/:id/members` +
`POST /invitations/:token/accept`; programs; affiliates; API keys; coupons; one coupon sale). Logins:
ORG_A_OWNER (OWNER, `*`), ORG_A_MANAGER (PROGRAM_MANAGER: coupons.view/create/edit/assign), ORG_A_VIEWER (VIEWER:
coupons.view), ORG_A_NOPERM (ANALYST: no coupon permission), ORG_B_OWNER, AFFILIATE_1/AFFILIATE_2 (affiliate-portal
accounts whose email matches Org A affiliate rows). Org A timezone set to Asia/Kolkata, Org B to UTC.
Not possible with the current code: a per-customer limit (no such field) — see M.

```
mysql> SELECT o.name, m.role, u.email FROM organization_memberships m JOIN users u ON u.id=m.userId JOIN organizations o ON o.id=m.organizationId WHERE o.name LIKE 'e2e-cpn-1791051925353%' ORDER BY o.name, m.role;
+-----------------------------+-----------------+--------------------------------------------------+
| name                        | role            | email                                            |
+-----------------------------+-----------------+--------------------------------------------------+
| e2e-cpn-1791051925353-org-a | ANALYST         | e2e-cpn-1791051925353-org_a_noperm@example.test  |
| e2e-cpn-1791051925353-org-a | OWNER           | e2e-cpn-1791051925353-org_a_owner@example.test   |
| e2e-cpn-1791051925353-org-a | PROGRAM_MANAGER | e2e-cpn-1791051925353-org_a_manager@example.test |
| e2e-cpn-1791051925353-org-a | VIEWER          | e2e-cpn-1791051925353-org_a_viewer@example.test  |
| e2e-cpn-1791051925353-org-b | OWNER           | e2e-cpn-1791051925353-org_b_owner@example.test   |
+-----------------------------+-----------------+--------------------------------------------------+
mysql> SELECT organizationId=..., name, defaultCommissionValue FROM programs ...;
+-----+-------------------------------+----------------+------+
| org | name                          | commissionType | bps  |
+-----+-------------------------------+----------------+------+
| A   | e2e-cpn-1791051925353-prog-a1 | PERCENTAGE     |  750 |
| A   | e2e-cpn-1791051925353-prog-a2 | PERCENTAGE     | 1000 |
| B   | e2e-cpn-1791051925353-prog-b1 | PERCENTAGE     |  500 |
+-----+-------------------------------+----------------+------+
+-----+---------------------------------------+--------+-------------------------------+
| org | displayName                           | status | program                       |
+-----+---------------------------------------+--------+-------------------------------+
| A   | e2e-cpn-1791051925353 Affiliate One   | ACTIVE | e2e-cpn-1791051925353-prog-a1 |
| A   | e2e-cpn-1791051925353 Affiliate Three | ACTIVE | e2e-cpn-1791051925353-prog-a2 |
| A   | e2e-cpn-1791051925353 Affiliate Two   | ACTIVE | e2e-cpn-1791051925353-prog-a1 |
| B   | e2e-cpn-1791051925353 Org B Affiliate | ACTIVE | e2e-cpn-1791051925353-prog-b1 |
+-----+---------------------------------------+--------+-------------------------------+
+------------------------------------------------+----------------+
| email                                          | affiliate_rows |
+------------------------------------------------+----------------+
| e2e-cpn-1791051925353-affiliate_1@example.test |              1 |
| e2e-cpn-1791051925353-affiliate_2@example.test |              1 |
+------------------------------------------------+----------------+
mysql> SELECT org, code, discountType, discountValue, status, maxRedemptions, validFrom, validUntil, assigned FROM organization_coupons ...;
+-----+---------------------------+--------------+---------------+----------+----------------+---------------------+---------------------+---------------------------------------+
| org | code                      | discountType | discountValue | status   | maxRedemptions | validFrom           | validUntil          | assigned                              |
+-----+---------------------------+--------------+---------------+----------+----------------+---------------------+---------------------+---------------------------------------+
| A   | E2E-CPN-MUSQ2MAX-ARCHIVED | FIXED_AMOUNT |           100 | ARCHIVED |           NULL | NULL                | NULL                | NULL                                  |
| A   | E2E-CPN-MUSQ2MAX-ENDS     | PERCENTAGE   |            20 | ACTIVE   |           NULL | NULL                | 2026-10-04 18:25:29 | e2e-cpn-1791051925353 Affiliate Two   |
| A   | E2E-CPN-MUSQ2MAX-EXPIRED  | FIXED_AMOUNT |            50 | ACTIVE   |           NULL | 2026-09-23 18:25:29 | 2026-10-02 18:25:29 | NULL                                  |
| A   | E2E-CPN-MUSQ2MAX-FIX200   | FIXED_AMOUNT |           200 | ACTIVE   |           NULL | NULL                | NULL                | e2e-cpn-1791051925353 Affiliate Two   |
| A   | E2E-CPN-MUSQ2MAX-LIMIT3   | PERCENTAGE   |             5 | ACTIVE   |              3 | NULL                | NULL                | e2e-cpn-1791051925353 Affiliate Three |
| A   | E2E-CPN-MUSQ2MAX-PAUSED   | PERCENTAGE   |            25 | PAUSED   |           NULL | NULL                | NULL                | NULL                                  |
| A   | E2E-CPN-MUSQ2MAX-PCT10    | PERCENTAGE   |            10 | ACTIVE   |           NULL | NULL                | NULL                | e2e-cpn-1791051925353 Affiliate One   |
| A   | E2E-CPN-MUSQ2MAX-SHARED   | PERCENTAGE   |            12 | ACTIVE   |           NULL | NULL                | NULL                | NULL                                  |
| A   | E2E-CPN-MUSQ2MAX-STARTS   | PERCENTAGE   |            15 | ACTIVE   |           NULL | 2026-10-04 18:25:29 | NULL                | e2e-cpn-1791051925353 Affiliate One   |
| A   | E2E-CPN-MUSQ2MAX-USED     | PERCENTAGE   |            10 | ACTIVE   |           NULL | NULL                | NULL                | e2e-cpn-1791051925353 Affiliate One   |
| B   | E2E-CPN-MUSQ2MAX-BONLY    | FIXED_AMOUNT |            75 | ACTIVE   |           NULL | NULL                | NULL                | e2e-cpn-1791051925353 Org B Affiliate |
| B   | E2E-CPN-MUSQ2MAX-SHARED   | PERCENTAGE   |            30 | ACTIVE   |           NULL | NULL                | NULL                | e2e-cpn-1791051925353 Org B Affiliate |
+-----+---------------------------+--------------+---------------+----------+----------------+---------------------+---------------------+---------------------------------------+
+------------------------------------+--------+-------------+---------+-------------------------+
| externalId                         | amount | affiliateId | status  | coupon                  |
+------------------------------------+--------+-------------+---------+-------------------------+
| e2e-cpn-1791051925353-seed-order-1 |  90000 | NULL        | PENDING | "E2E-CPN-MUSQ2MAX-USED" |
+------------------------------------+--------+-------------+---------+-------------------------+
+--------------------------------------+--------------+
| organizationId                       | timezone     |
+--------------------------------------+--------------+
| eb2b08d5-22c4-4dd7-a225-37421c48f27e | Asia/Kolkata |
| f93f90d6-f027-465d-9fca-c2f0bae66ce1 | UTC          |
+--------------------------------------+--------------+
```

Finding while seeding (store, report only): the seed sale shows `status=PENDING` in MySQL but the API (memory) returns:
```
GET /api/v1/organizations/<orgA>/conversions
[{"externalId":"e2e-cpn-1791051925353-seed-order-1","status":"APPROVED","validationStatus":"VALID"}]
mysql> SELECT id, status, affiliateId, validationStatus FROM conversions WHERE externalId='e2e-cpn-1791051925353-seed-order-1';
44caf0ab-5df0-4467-8f23-648f73856e85	PENDING	NULL	VALID
```
`validationStatus` (assigned after `status`) landed but `status=APPROVED` was overwritten by an older full-row upsert —
a lost update in `DBBackedArray` (each property assignment fires an independent full-row upsert; they can complete out
of order). After a restart this sale reverts to PENDING. Also: the coupon sale got `affiliateId NULL` and no
commission even though the code belongs to AFFILIATE_1 (see K).
