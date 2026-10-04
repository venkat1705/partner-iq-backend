/**
 * Images (program logos/banners, organization logos, affiliate avatars) — streamed multipart upload through
 * StorageService (replaces the former Cloudinary base64 upload). Images are public by nature (shown on public program
 * pages and in emails), so they are served by GET /api/v1/media/:id, which redirects to a short-lived signed URL; the
 * bucket itself stays private. Images do not count toward the organization's asset storage (decision A13) but are
 * limited to STORAGE_MAX_IMAGE_BYTES each.
 */
import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import Busboy from 'busboy';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { IMAGE_FILE_TYPES, StorageService, StorageTooLargeError } from '../../common/storage';
import { getAppConfig } from '../../config/app.config';
import { initializeDataSource } from '../../database/data-source';
import { StoredObject } from '../../database/schema';

export type MediaOwner =
  | { kind: 'org'; organizationId: string; purpose: 'program-logo' | 'program-banner' | 'organization-logo' }
  | { kind: 'user'; userId: string; purpose: 'affiliate-avatar' | 'user-avatar' };

export const ORG_MEDIA_PURPOSES = ['program-logo', 'program-banner', 'organization-logo'] as const;

export interface UploadedImage {
  mediaId: string;
  url: string;
  /** kept for older clients that read secureUrl */
  secureUrl: string;
  bytes: number;
  contentType: string;
}

@Injectable()
export class MediaService {
  constructor(private readonly storage: StorageService) {}

  private size(req: Request): number {
    const raw = (req.headers['x-file-size'] ?? req.headers['content-length']) as string | undefined;
    if (!raw || !/^\d{1,12}$/.test(String(raw).trim())) {
      throw new HttpException({ statusCode: HttpStatus.LENGTH_REQUIRED, code: 'LENGTH_REQUIRED', message: 'Send the image size in the X-File-Size header (or a Content-Length).' }, HttpStatus.LENGTH_REQUIRED);
    }
    const bytes = Number(String(raw).trim());
    const limit = this.storage.settings.maxImageBytes;
    if (bytes > limit + 64 * 1024 && !req.headers['x-file-size']) throw new StorageTooLargeError(`Images can be at most ${limit} bytes.`, limit);
    if (req.headers['x-file-size'] && bytes > limit) throw new StorageTooLargeError(`Images can be at most ${limit} bytes.`, limit);
    return Math.min(bytes, limit);
  }

  /** Stream one image ("file" part) to storage. For org media the purpose comes from the "purpose" field (before the file). */
  async uploadImage(req: Request, owner: (purpose: string | undefined) => MediaOwner, actorId: string): Promise<UploadedImage> {
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) {
      throw new HttpException({ statusCode: 415, code: 'MULTIPART_REQUIRED', message: 'Send the image as multipart/form-data with a "file" part.' }, 415);
    }
    const maxBytes = this.size(req);
    const abort = new AbortController();
    req.on('close', () => {
      if (!req.complete) abort.abort();
    });
    return new Promise<UploadedImage>((resolve, reject) => {
      const fields: Record<string, string> = {};
      let started: Promise<UploadedImage> | null = null;
      let bb: Busboy.Busboy;
      try {
        bb = Busboy({ headers: req.headers, limits: { files: 1, fields: 5, fieldSize: 1024, fileSize: maxBytes + 1 } });
      } catch (err: any) {
        reject(new BadRequestException(`Malformed multipart request: ${err?.message || err}`));
        return;
      }
      bb.on('field', (name, value) => (fields[name] = value));
      bb.on('file', (name, stream, info) => {
        if (started || name !== 'file') {
          stream.resume();
          return;
        }
        started = (async () => {
          const target = owner(fields.purpose);
          const key = target.kind === 'org'
            ? this.storage.buildKey({ kind: 'org-media', organizationId: target.organizationId, purpose: target.purpose })
            : this.storage.buildKey({ kind: 'user-avatar', userId: target.userId });
          const ctx = { organizationId: target.kind === 'org' ? target.organizationId : `user:${target.userId}` };
          const stored = await this.storage.uploadStream({ key, body: stream, originalFileName: info.filename || 'image', maxBytes, allowedTypes: IMAGE_FILE_TYPES, signal: abort.signal, ...ctx });
          const ds = await initializeDataSource();
          const id = randomUUID();
          try {
            await ds.getRepository(StoredObject).insert({
              id, organizationId: target.kind === 'org' ? target.organizationId : null, ownerUserId: target.kind === 'user' ? target.userId : null,
              storageKey: key, kind: target.kind === 'org' ? 'MEDIA' : 'AVATAR', countsTowardQuota: false, sizeBytes: stored.sizeBytes,
              checksumSha256: stored.checksumSha256, contentType: stored.contentType, originalFileName: (info.filename || '').slice(0, 255), purpose: target.purpose, createdBy: actorId, createdAt: new Date(),
            } as StoredObject);
          } catch (err) {
            await this.storage.deleteObject(key, ctx).catch(() => undefined);
            throw err;
          }
          const url = `${getAppConfig().appUrl.replace(/\/$/, '')}/api/v1/media/${id}`;
          return { mediaId: id, url, secureUrl: url, bytes: stored.sizeBytes, contentType: stored.contentType };
        })();
        started.catch(() => stream.resume());
      });
      bb.on('error', (err: any) => reject(new BadRequestException(`The upload could not be read: ${err?.message || err}`)));
      bb.on('close', () => {
        if (!started) reject(new BadRequestException({ statusCode: 400, code: 'FILE_REQUIRED', message: 'No "file" part was sent.' }));
        else started.then(resolve, reject);
      });
      req.pipe(bb);
    });
  }

  /** Signed, short-lived URL for a public image (logos, banners, avatars). */
  async publicUrl(mediaId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new NotFoundException('MEDIA_NOT_FOUND');
    const ds = await initializeDataSource();
    const obj = await ds.getRepository(StoredObject).findOne({ where: { id: mediaId } });
    if (!obj || !['MEDIA', 'AVATAR'].includes(obj.kind)) throw new NotFoundException('MEDIA_NOT_FOUND');
    return this.storage.getDownloadUrl(obj.storageKey, {
      organizationId: obj.organizationId || `user:${obj.ownerUserId}`,
      fileName: obj.originalFileName || 'image',
      contentType: obj.contentType,
      disposition: 'inline',
    });
  }
}
