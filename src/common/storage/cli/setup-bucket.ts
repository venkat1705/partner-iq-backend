/**
 * Applies the bucket settings (Block Public Access, default encryption, abort-incomplete-multipart lifecycle rule)
 * and prints what the storage service reports back. Run after deploying a new bucket:
 *   npm run storage:setup            (compiled: node dist/src/common/storage/cli/setup-bucket.js)
 *   npm run storage:describe         (report only)
 */
import { createStorageService } from '../storage.module';

(async () => {
  const describeOnly = process.argv.includes('--describe');
  const storage = createStorageService();
  const report = describeOnly ? await storage.describeBucketSettings() : await storage.ensureBucketSettings();
  console.log(JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
