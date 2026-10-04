import fs from 'node:fs';
import path from 'node:path';
/** One id per run: proof files are truncated the first time they are written in a new run. */
export default async function globalSetup() {
  fs.writeFileSync(path.resolve(__dirname, '.run-id'), String(Date.now()));
}
