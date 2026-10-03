import fs from 'node:fs';
import path from 'node:path';
import { ApiResult } from './api';

const DIR = path.resolve(__dirname, '..', '..', 'docs', 'coupons-proof');
const RUN_FILE = path.resolve(__dirname, '..', '.run-id');

function runId() {
  return fs.existsSync(RUN_FILE) ? fs.readFileSync(RUN_FILE, 'utf8').trim() : 'adhoc';
}

/**
 * Collects raw request/response/SQL text for one scenario into docs/coupons-proof/<letter>.txt.
 * Appends immediately (Playwright restarts the worker after a failed test), and truncates the file
 * the first time it is touched in a new run (run id written by global-setup).
 */
export class Proof {
  private file: string;
  constructor(letter: string) {
    fs.mkdirSync(DIR, { recursive: true });
    this.file = path.join(DIR, `${letter}.txt`);
    const id = runId();
    const head = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8').split('\n', 1)[0] : '';
    if (!head.includes(`run=${id}`)) {
      fs.writeFileSync(this.file, `# Scenario ${letter} — raw proof, run=${id} (started ${new Date().toISOString()})\n`);
    }
  }
  private w(s: string) {
    fs.appendFileSync(this.file, s + '\n');
  }
  h(title: string) {
    this.w(`\n==== ${title} ====`);
  }
  http(method: string, url: string, r: ApiResult, reqBody?: unknown) {
    this.w(`> ${method} ${url}${reqBody !== undefined ? `\n> body: ${typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody)}` : ''}`);
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    this.w(`< HTTP ${r.status} (${r.ms.toFixed(0)} ms)\n< ${body && body.length > 3000 ? body.slice(0, 3000) + ' …[truncated]' : body}`);
  }
  sql(query: string, rows: unknown) {
    this.w(`mysql> ${query.replace(/\s+/g, ' ').trim()}`);
    this.w(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
  }
  note(text: string) {
    this.w(text);
  }
  check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    this.w(`CHECK ${ok ? 'PASS' : 'FAIL'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    return ok;
  }
  flush() {
    /* kept for compatibility: writes are immediate */
  }
}
