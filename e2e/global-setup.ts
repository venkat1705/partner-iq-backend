import fs from 'node:fs';
import path from 'node:path';
export default async function globalSetup() {
  fs.writeFileSync(path.resolve(__dirname, '.run-id'), `${Date.now()}`);
}
