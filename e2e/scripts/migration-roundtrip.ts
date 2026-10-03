/**
 * Proves CouponRedemptionLedger2026100300000 is reversible and lossless on a scratch database that has the
 * pre-audit organization_coupons shape (int discountValue, no maxRedemptionsPerCustomer, no unique code index):
 * up → down → up, checking data after each step, plus the refusal cases of down.
 */
import mysql from 'mysql2/promise';
import { DataSource } from 'typeorm';
import { CouponRedemptionLedger2026100300000 as M } from '../../src/database/migrations/2026100300000_CouponRedemptionLedger';
import { ENV } from '../lib/env';

const DB = 'partneriq_migtest';
(async () => {
  const conn = await mysql.createConnection({ ...ENV.DB, database: DB });
  const q = async (s: string, p: unknown[] = []) => (await conn.query(s, p))[0] as any;
  await q(`CREATE TABLE organization_coupons (
    id varchar(36) NOT NULL, organizationId varchar(255) NOT NULL, code varchar(60) NOT NULL, normalizedCode varchar(60) NOT NULL,
    name varchar(160) NOT NULL, description text, discountType varchar(30) NOT NULL DEFAULT 'PERCENTAGE', discountValue int NOT NULL,
    status varchar(30) NOT NULL DEFAULT 'ACTIVE', maxRedemptions int DEFAULT NULL, validFrom timestamp NULL, validUntil timestamp NULL,
    createdBy varchar(255) NOT NULL, createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await q(`INSERT INTO organization_coupons (id, organizationId, code, normalizedCode, name, discountValue, maxRedemptions, createdBy) VALUES
    ('c1','o1','SAVE10','SAVE10','a',10,5,'u'), ('c2','o1','FIX200','FIX200','b',200,NULL,'u'), ('c3','o2','SAVE10','SAVE10','c',15,NULL,'u')`);
  const snapshot = async () => {
    const hasExact = (await q(`SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='organization_coupons' AND COLUMN_NAME='discountValueExact'`, [DB]))[0].n > 0;
    return q(`SELECT id, organizationId, normalizedCode, discountValue, ${hasExact ? 'discountValueExact+0 AS discountValueExact' : 'NULL AS discountValueExact'}, maxRedemptions FROM organization_coupons ORDER BY id`);
  };
  const shape = async () => ({
    discountValue: (await q(`SELECT DATA_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='organization_coupons' AND COLUMN_NAME='discountValue'`, [DB]))[0].t,
    discountValueExact: (await q(`SELECT DATA_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='organization_coupons' AND COLUMN_NAME='discountValueExact'`, [DB]))[0]?.t ?? null,
    perCustomer: (await q(`SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='organization_coupons' AND COLUMN_NAME='maxRedemptionsPerCustomer'`, [DB]))[0].n,
    tables: (await q(`SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY 1`, [DB])).map((r: any) => r.t),
    uniques: (await q(`SELECT INDEX_NAME i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='organization_coupons' AND NON_UNIQUE=0 GROUP BY INDEX_NAME`, [DB])).map((r: any) => r.i),
  });
  const ds = new DataSource({ type: 'mysql', host: ENV.DB.host, port: ENV.DB.port, username: ENV.DB.user, password: ENV.DB.password, database: DB });
  await ds.initialize();
  const qr = ds.createQueryRunner();
  const m = new M();
  const log = async (label: string) => console.log(label, JSON.stringify({ shape: await shape(), rows: await snapshot() }));
  await log('before:');
  await m.up(qr); await log('after up:');
  await m.up(qr); await log('after 2nd up (idempotent):');
  await q(`UPDATE organization_coupons SET discountValueExact = 12.5, discountValue = 13 WHERE id='c1'`);
  await m.down(qr).then(() => console.log('down with 12.5 present: UNEXPECTED SUCCESS'), (e) => console.log('down with 12.5 present: refused ->', e.message));
  await q(`UPDATE organization_coupons SET discountValueExact = 10, discountValue = 10 WHERE id='c1'`);
  await q(`INSERT INTO organization_coupon_redemptions (id, organizationId, environment, couponId, couponCode, conversionId, orderExternalId, customerKey, orderAmount, discountAmount, grossAmount, currency, discountType, discountValue, occurredAt)
           VALUES ('r1','o1','LIVE','c1','SAVE10','v1','ord1','id:x',900,100,1000,'INR','PERCENTAGE',10,NOW())`);
  await m.down(qr).then(() => console.log('down with a recorded use: UNEXPECTED SUCCESS'), (e) => console.log('down with a recorded use: refused ->', e.message));
  await log('state after refused downs (nothing lost):');
  await q(`DELETE FROM organization_coupon_redemptions`);
  await m.down(qr); await log('after down:');
  await m.up(qr); await log('after up again:');
  await q(`INSERT INTO organization_coupons (id, organizationId, code, normalizedCode, name, discountValue, createdBy) VALUES ('c4','o1','SAVE10','SAVE10','dup',1,'u')`).then(
    () => console.log('duplicate (o1, SAVE10) insert: UNEXPECTED SUCCESS'), (e) => console.log('duplicate (o1, SAVE10) insert after up: rejected ->', e.code));
  await qr.release(); await ds.destroy(); await conn.end();
})().catch((e) => { console.error(e); process.exit(1); });
