import fs from 'node:fs';
import { FIXTURES_FILE } from './env';

export interface OrgFixture {
  id: string;
  name: string;
  apiKey: string;
  programs: { id: string; name: string; bps: number }[];
  affiliates: { id: string; email: string; displayName: string; programId: string }[];
  coupons: Record<string, { id: string; code: string }>;
}
export interface Fixtures {
  ts: number;
  run: string;
  prefix: string;
  users: Record<string, { email: string; userId: string; token: string; role: string; kind: 'workspace' | 'affiliate' }>;
  orgA: OrgFixture;
  orgB: OrgFixture;
}
export function loadFixtures(): Fixtures {
  if (!fs.existsSync(FIXTURES_FILE)) throw new Error(`Run "npm run seed" in e2e/ first (${FIXTURES_FILE} missing)`);
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'));
}
export function saveFixtures(f: Fixtures) {
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(f, null, 2));
}
/** Unique code helper: every spec creates its own codes under the run prefix. */
export function code(f: Fixtures, suffix: string) {
  return `E2E-CPN-${f.run}-${suffix}`.toUpperCase();
}
