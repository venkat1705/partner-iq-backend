import fs from 'node:fs';
import { FIXTURES_FILE } from './env';

export interface AffiliateFixture { id: string; email: string; displayName: string; programId: string }
export interface OrgFixture {
  id: string;
  name: string;
  apiKey?: string;
  programs: { id: string; name: string }[];
  affiliates: AffiliateFixture[];
  /** tiers by code (program pA1) */
  tiers: Record<string, { id: string; level: number; programId: string }>;
}
export interface UserFixture { email: string; userId: string; token: string; role: string; kind: 'workspace' | 'affiliate' | 'platform' }
export interface Fixtures {
  ts: number;
  run: string;
  prefix: string;
  users: Record<string, UserFixture>;
  orgA: OrgFixture;
  orgB: OrgFixture;
  orgEmpty?: { id: string };
  orgPerf?: { id: string };
}
export function loadFixtures(): Fixtures {
  if (!fs.existsSync(FIXTURES_FILE)) throw new Error(`Run "npm run seed" in e2e-assets/ first (${FIXTURES_FILE} missing)`);
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'));
}
export function saveFixtures(f: Fixtures) {
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(f, null, 2));
}
