import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * Scenario A — "one place only". Fails when any backend source file outside src/common/storage imports the AWS SDK
 * (static import, dynamic import or require) or writes files to local disk. Runs without ESLint so it also guards
 * environments that skip linting.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DIR = path.join(ROOT, 'src', 'common', 'storage') + path.sep;
const FS_WRITE_ALLOWLIST = new Set([
  // development-only email provider writes rendered email HTML for local inspection (not uploaded files)
  path.join(ROOT, 'src', 'modules', 'email-design', 'providers', 'development-email.provider.ts'),
]);
const AWS_IMPORT = /(?:from\s+['"]|import\(\s*['"]|require\(\s*['"])(?:@aws-sdk\/|@smithy\/|aws-sdk['"/])/;
const FS_WRITE = /\b(?:fs|fsp|promises)\.(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|copyFileSync|rename|renameSync|unlink|unlinkSync|rm|rmSync|mkdir|mkdirSync|truncate|truncateSync)\s*\(|import\s*\{[^}]*\b(?:writeFile|writeFileSync|createWriteStream|appendFile|appendFileSync)\b[^}]*\}\s*from\s*['"](?:node:)?fs(?:\/promises)?['"]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('storage architecture (A)', () => {
  const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'server.ts')];

  it('scans the whole backend source tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.startsWith(STORAGE_DIR))).toBe(true);
  });

  it('no file outside src/common/storage imports the AWS SDK', () => {
    const offenders = files.filter((f) => !f.startsWith(STORAGE_DIR) && AWS_IMPORT.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('the storage module does import the AWS SDK (the rule is not vacuous)', () => {
    const inside = files.filter((f) => f.startsWith(STORAGE_DIR) && AWS_IMPORT.test(fs.readFileSync(f, 'utf8')));
    expect(inside.map((f) => path.relative(ROOT, f))).toContain(path.join('src', 'common', 'storage', 'providers', 's3-storage.provider.ts'));
  });

  it('no file outside src/common/storage writes files to local disk (except the dev email provider)', () => {
    const offenders = files.filter((f) => !f.startsWith(STORAGE_DIR) && !FS_WRITE_ALLOWLIST.has(f) && FS_WRITE.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('the detector recognises SDK imports and fs writes', () => {
    expect(AWS_IMPORT.test("import { S3Client } from '@aws-sdk/client-s3';")).toBe(true);
    expect(AWS_IMPORT.test("const s3 = require('@aws-sdk/lib-storage')")).toBe(true);
    expect(AWS_IMPORT.test("await import('@aws-sdk/client-s3')")).toBe(true);
    expect(FS_WRITE.test("fs.writeFileSync('/tmp/x', data)")).toBe(true);
    expect(FS_WRITE.test("import { createWriteStream } from 'node:fs';")).toBe(true);
    expect(FS_WRITE.test("fs.readFileSync('/tmp/x')")).toBe(false);
  });
});
