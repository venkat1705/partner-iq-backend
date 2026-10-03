import { expect } from '@playwright/test';
import { api } from './api';
import { commissionsFor, conversionByExternalId, F, orgPath, recordSale, redemptions } from './coupons';
import { sql } from './db';
import { Proof } from './proof';
import { as } from './session';

/** Creates a coupon as ORG_A_OWNER (or owner of orgId) and returns its API representation. */
export async function newCoupon(proof: Proof, orgId: string, body: Record<string, unknown>, ownerRole = 'ORG_A_OWNER') {
  const owner = await as(ownerRole);
  const r = await api('POST', orgPath(orgId), { token: owner.token, body });
  proof.http('POST', orgPath(orgId), r, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.data;
}

export interface SaleOutcome {
  status: number;
  body: any;
  conversion: any;
  commissions: any[];
  redemption: any | undefined;
}

/** Posts a sale with the API key, then reads the conversion, commissions and coupon redemption back from SQL. */
export async function sale(proof: Proof, apiKey: string, orgId: string, body: Record<string, unknown>, couponId?: string): Promise<SaleOutcome> {
  const r = await recordSale(apiKey, body);
  proof.http('POST', '/conversions', r, body);
  await new Promise((res) => setTimeout(res, 250));
  const conversion = await conversionByExternalId(orgId, String(body.externalId));
  const comms = conversion ? await commissionsFor(conversion.id) : [];
  const reds = couponId ? await redemptions(couponId) : null;
  const redemption = reds?.find((x: any) => x.conversionId === conversion?.id);
  proof.sql(`SELECT id, affiliateId, programId, amount, status, occurredAt FROM conversions WHERE externalId='${body.externalId}'`,
    conversion && { id: conversion.id, affiliateId: conversion.affiliateId, programId: conversion.programId, amount: conversion.amount, status: conversion.status, occurredAt: conversion.occurredAt });
  proof.sql(`SELECT affiliateId, commissionAmount, reversedAmount, status FROM commissions WHERE conversionId='${conversion?.id}'`,
    comms.map((c: any) => ({ affiliateId: c.affiliateId, commissionAmount: c.commissionAmount, reversedAmount: c.reversedAmount, status: c.status })));
  if (couponId) proof.sql(`SELECT * FROM organization_coupon_redemptions WHERE couponId='${couponId}' AND conversionId='${conversion?.id}'`, reds === null ? 'TABLE organization_coupon_redemptions DOES NOT EXIST' : redemption ?? []);
  return { status: r.status, body: r.body, conversion, commissions: comms, redemption };
}

export async function usageCount(couponId: string) {
  const r = await sql<{ n: number }>(`SELECT COUNT(*) n FROM organization_coupon_redemptions WHERE couponId=?`, [couponId]).catch(() => [{ n: -1 }]);
  return Number(r[0].n);
}

export const fx = () => F();
