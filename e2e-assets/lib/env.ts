import fs from 'node:fs';
import path from 'node:path';

/** Reads backend/.env (never committed) so DB creds are not duplicated in the repo. */
function loadBackendEnv(): Record<string, string> {
  const file = path.resolve(__dirname, '..', '..', '.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const be = loadBackendEnv();
export const ENV = {
  API: process.env.E2E_API_URL || 'http://localhost:5000/api/v1',
  ADMIN_UI: process.env.E2E_ADMIN_URL || 'http://localhost:3001',
  PORTAL_UI: process.env.E2E_PORTAL_URL || 'http://localhost:3005',
  DB: {
    host: process.env.DATABASE_HOST || be.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || be.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USER || be.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD ?? be.DATABASE_PASSWORD ?? '',
    database: process.env.DATABASE_NAME || be.DATABASE_NAME,
  },
  /** Password of the e2e test users: set E2E_PASSWORD (never committed). */
  get PASSWORD(): string {
    const value = process.env.E2E_PASSWORD;
    if (!value) throw new Error('Set E2E_PASSWORD (password for the e2e-ast test users)');
    return value;
  },
};
export const FIXTURES_FILE = path.resolve(__dirname, '..', '.fixtures.json');
