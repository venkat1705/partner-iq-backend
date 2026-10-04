/**
 * Thumbnails for image assets (JPEG/PNG/GIF/WebP). Generated after the upload is saved, one at a time, and stored
 * through StorageService under orgs/{orgId}/thumbnails/... They do not count toward the organization's storage.
 *
 * Safety: libvips refuses images above THUMBNAIL_MAX_PIXELS before decoding (decompression bombs), every job has a
 * time limit, and the source must be at most THUMBNAIL_MAX_SOURCE_BYTES. A failure is recorded on the asset
 * (metadata.thumbnailStatus) and logged — the upload itself is unaffected. Output is a re-encoded JPEG without any
 * metadata, so EXIF (including GPS) never appears in thumbnails.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { FileTypeId, IMAGE_FILE_TYPES, StorageService } from '../../common/storage';
import { repos } from './asset-common';

export const THUMBNAIL_MAX_PIXELS = 40_000_000; // ≈ 6300 × 6300
export const THUMBNAIL_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const THUMBNAIL_TIMEOUT_SECONDS = 15;
const THUMBNAIL_SIZE = 320;

sharp.cache(false);
sharp.concurrency(1);

@Injectable()
export class AssetThumbnailService {
  private readonly logger = new Logger('AssetThumbnails');
  private queue: Promise<void> = Promise.resolve();
  /** for tests: resolves when every scheduled job has finished */
  idle(): Promise<void> {
    return this.queue;
  }

  constructor(private readonly storage: StorageService) {}

  schedule(organizationId: string, assetId: string, sourceKey: string, fileType: FileTypeId, sizeBytes: number) {
    if (!IMAGE_FILE_TYPES.includes(fileType)) return;
    this.queue = this.queue.then(() => this.generate(organizationId, assetId, sourceKey, sizeBytes)).catch((err) => {
      this.logger.error(`thumbnail job crashed for asset ${assetId}: ${err?.message || err}`);
    });
  }

  private async setStatus(assetId: string, status: string, extra: { width?: number; height?: number } = {}) {
    const { assets } = await repos();
    const asset = await assets.findOneBy({ id: assetId });
    if (!asset) return;
    await assets.update({ id: assetId }, { metadata: { ...(asset.metadata || {}), thumbnailStatus: status }, ...extra });
  }

  async generate(organizationId: string, assetId: string, sourceKey: string, sizeBytes: number) {
    const ctx = { organizationId };
    if (sizeBytes > THUMBNAIL_MAX_SOURCE_BYTES) {
      await this.setStatus(assetId, 'SKIPPED_TOO_LARGE');
      return;
    }
    const started = Date.now();
    try {
      const source = await this.storage.getObjectStream(sourceKey, ctx);
      const chunks: Buffer[] = [];
      for await (const c of source as AsyncIterable<Buffer>) chunks.push(c);
      const input = Buffer.concat(chunks);
      const image = sharp(input, { limitInputPixels: THUMBNAIL_MAX_PIXELS, failOn: 'error', animated: false }).timeout({ seconds: THUMBNAIL_TIMEOUT_SECONDS });
      const meta = await image.metadata();
      const output = await image.rotate().resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 78 }).toBuffer();
      const { assets, objects } = await repos();
      const current = await assets.findOneBy({ id: assetId });
      if (!current || current.storageKey !== sourceKey) return; // replaced or deleted meanwhile
      const key = this.storage.buildKey({ kind: 'asset-thumbnail', organizationId, assetId, size: String(THUMBNAIL_SIZE) });
      const stored = await this.storage.putGeneratedObject(key, output, 'image/jpeg', ctx);
      const old = await objects.find({ where: { assetId, kind: 'THUMBNAIL' } });
      await objects.insert({
        id: randomUUID(), organizationId, storageKey: key, kind: 'THUMBNAIL', countsTowardQuota: false, sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256, contentType: 'image/jpeg', assetId, purpose: `thumb-${THUMBNAIL_SIZE}`, createdAt: new Date(),
      } as any);
      if (old.length) {
        await objects.delete(old.map((o) => o.id));
        await this.storage.deleteObjects(old.map((o) => o.storageKey), ctx).catch((e) => this.logger.warn(`old thumbnail delete failed: ${e?.message || e}`));
      }
      await this.setStatus(assetId, 'READY', { width: meta.width, height: meta.height });
      this.logger.log(`thumbnail asset=${assetId} ${meta.width}x${meta.height} -> ${output.length} bytes in ${Date.now() - started} ms`);
    } catch (err: any) {
      const reason = /pixel limit|exceeds limit/i.test(String(err?.message)) ? 'FAILED_IMAGE_TOO_LARGE' : /timeout/i.test(String(err?.message)) ? 'FAILED_TIMEOUT' : 'FAILED';
      this.logger.warn(`thumbnail asset=${assetId} ${reason}: ${err?.message || err} (${Date.now() - started} ms)`);
      await this.setStatus(assetId, reason).catch((e) => this.logger.error(`could not record thumbnail status: ${e?.message || e}`));
    }
  }
}
