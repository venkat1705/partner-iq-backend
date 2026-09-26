import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

process.env.NODE_ENV = 'test';

const cwd = process.cwd();
const testEnvPath = path.resolve(cwd, '.env.test');
const fallbackPath = path.resolve(cwd, 'backend', '.env.test');

if (fs.existsSync(testEnvPath)) {
  dotenv.config({ path: testEnvPath, override: true });
} else if (fs.existsSync(fallbackPath)) {
  dotenv.config({ path: fallbackPath, override: true });
}

