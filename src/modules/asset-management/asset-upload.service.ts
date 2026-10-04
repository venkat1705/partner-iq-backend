/**
 * Streaming multipart uploads for assets and new versions: browser → backend → storage, never through memory or
 * local disk.
 *
 *  1. Size to reserve = X-File-Size header (declared file size) or, if absent, the request's Content-Length; neither
 *     → 411. Larger than the per-file limit → 413 before reading the body.
 *  2. Form fields (must come before the file part) are validated; invalid → 400, nothing reserved.
 *  3. Space is reserved atomically (StorageQuotaService.reserve → 413 / 429) before any byte goes to storage.
 *  4. The file part is piped into StorageService.uploadStream (magic bytes, byte counting with abort at the reserved
 *     amount, SHA-256, size verified with HEAD).
 *  5. One MySQL transaction: reserved → used (real size) + asset/version/stored_object rows + audit row.
 *  Any failure: storage object deleted (or multipart aborted), reservation released, clear error.
 */
import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Busboy from 'busboy';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Readable } from 'stream';
import { AssetSourceType, AssetStatus } from '../../common/enums';
import { StorageService, StorageTooLargeError, StoredObjectInfo, extensionOf } from '../../common/storage';
import { dbStore } from '../../database/store';
import { Asset, AssetVersion, StoredObject } from '../../database/schema';
import { StorageQuotaService } from '../storage-quota/storage-quota.service';
import { ASSET_AUDIT_FIELDS, displayFileName, inTx, pick, repos, writeAudit } from './asset-common';
import { AssetThumbnailService } from './asset-thumbnail.service';
import { UploadAssetFieldsDto, UploadVersionFieldsDto } from './dto/asset-management.dto';

export type UploadMode = { kind: 'asset' } | { kind: 'version'; assetId: string };

class LengthRequiredException extends HttpException {
  constructor(message: string) {
    super({ statusCode: HttpStatus.LENGTH_REQUIRED, code: 'LENGTH_REQUIRED', message }, HttpStatus.LENGTH_REQUIRED);
  }
}

function parseFields(raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (['isPublicToAffiliates', 'isDownloadable', 'isCopyable'].includes(k)) out[k] = v === 'true' ? true : v === 'false' ? false : v;
    else if (k === 'tags') {
      const t = v.trim();
      if (t.startsWith('[')) {
        try {
          out[k] = JSON.parse(t);
        } catch {
          out[k] = t;
        }
      } else out[k] = t ? t.split(',').map((s) => s.trim()).filter(Boolean) : [];
    } else if (['programId'].includes(k) && v === '') continue;
    else out[k] = v;
  }
  return out;
}

async function validateFields<T extends object>(cls: new () => T, raw: Record<string, string>): Promise<T> {
  const dto = plainToInstance(cls, parseFields(raw));
  const errors = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const messages = errors.flatMap((e) => (e.constraints ? Object.values(e.constraints) : [`${e.property} is invalid`]));
    throw new BadRequestException({ statusCode: 400, code: 'VALIDATION_ERROR', message: messages });
  }
  return dto;
}

@Injectable()
export class AssetUploadService {
  private readonly logger = new Logger('AssetUpload');

  constructor(
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
    private readonly thumbnails: AssetThumbnailService,
  ) {}

  /** Size to reserve, from the declared file size or the Content-Length. */
  private sizeToReserve(req: Request): number {
    const declaredRaw = req.headers['x-file-size'];
    const lengthRaw = req.headers['content-length'];
    const parse = (v: unknown) => (typeof v === 'string' && /^\d{1,16}$/.test(v.trim()) ? Number(v.trim()) : undefined);
    const declared = parse(declaredRaw);
    const length = parse(lengthRaw);
    if (declaredRaw !== undefined && declared === undefined) throw new BadRequestException('X-File-Size must be the file size in bytes.');
    if (declared === undefined && length === undefined) {
      throw new LengthRequiredException('The upload size is unknown. Send the file size in the X-File-Size header (or a Content-Length).');
    }
    if (declared !== undefined && declared < 1) throw new BadRequestException({ statusCode: 400, code: 'EMPTY_FILE', message: 'The file is empty.' });
    if (declared !== undefined && length !== undefined && declared > length) throw new BadRequestException('X-File-Size is larger than the request body.');
    const bytes = declared ?? length!;
    if (bytes > this.storage.settings.maxFileBytes) {
      throw new StorageTooLargeError(`Files can be at most ${this.storage.settings.maxFileBytes} bytes; this one is ${bytes} bytes.`, this.storage.settings.maxFileBytes);
    }
    return bytes;
  }

  async upload(req: Request, res: Response, organizationId: string, actorId: string, mode: UploadMode) {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      throw new HttpException({ statusCode: 415, code: 'MULTIPART_REQUIRED', message: 'Send the file as multipart/form-data with a "file" part.' }, 415);
    }
    const reserveBytes = this.sizeToReserve(req);

    let target: Asset | undefined;
    if (mode.kind === 'version') {
      const { assets } = await repos();
      target = (await assets.findOne({ where: { id: mode.assetId, organizationId } })) ?? undefined;
      if (!target || target.deletedAt) throw new NotFoundException('ASSET_NOT_FOUND');
      if (target.sourceType !== AssetSourceType.FILE) throw new BadRequestException('Only file assets have file versions.');
    }

    const abort = new AbortController();
    let finished = false;
    req.on('close', () => {
      if (!finished && !req.complete) abort.abort();
    });

    // on an early rejection the rest of a large body is not read: close the connection after answering
    const closeConnection = () => {
      if (!res.headersSent) res.setHeader('Connection', 'close');
    };

    return new Promise((resolve, reject) => {
      const fields: Record<string, string> = {};
      let filePromise: Promise<unknown> | null = null;
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        finished = true;
        fn();
      };
      let bb: Busboy.Busboy;
      try {
        bb = Busboy({ headers: req.headers, limits: { files: 1, fields: 40, fieldSize: 64 * 1024, parts: 50, fileSize: reserveBytes + 1 } });
      } catch (err: any) {
        reject(new BadRequestException(`Malformed multipart request: ${err?.message || err}`));
        return;
      }
      bb.on('field', (name, value, info) => {
        if (info.valueTruncated) fields[name] = '\u0000too-long';
        else fields[name] = value;
      });
      bb.on('file', (name, stream, info) => {
        if (filePromise || name !== 'file') {
          stream.resume();
          return;
        }
        filePromise = this.handleFile(stream, info.filename || '', fields, reserveBytes, organizationId, actorId, mode, target, abort.signal);
        filePromise.catch((err) => {
          stream.resume();
          closeConnection();
          done(() => reject(err));
        });
      });
      bb.on('error', (err: any) => {
        abort.abort();
        done(() => reject(new BadRequestException(`The upload could not be read: ${err?.message || err}`)));
      });
      bb.on('close', () => {
        if (!filePromise) {
          done(() => reject(new BadRequestException({ statusCode: 400, code: 'FILE_REQUIRED', message: 'No "file" part was sent.' })));
          return;
        }
        filePromise.then((value) => done(() => resolve(value)), (err) => done(() => reject(err)));
      });
      req.pipe(bb);
    });
  }

  private async handleFile(
    stream: Readable,
    originalName: string,
    rawFields: Record<string, string>,
    reserveBytes: number,
    organizationId: string,
    actorId: string,
    mode: UploadMode,
    target: Asset | undefined,
    signal: AbortSignal,
  ) {
    if (Object.values(rawFields).includes('\u0000too-long')) throw new BadRequestException('A form field is too long.');
    if (!originalName.trim()) throw new BadRequestException('The file part has no file name.');
    const fileName = displayFileName(originalName);
    const ext = extensionOf(originalName);
    if (!ext || !this.storage.settings.allowedExtensions.includes(ext)) {
      throw new HttpException({ statusCode: 415, code: 'STORAGE_FILE_TYPE_REJECTED', message: `.${ext || '?'} files are not allowed. Allowed: ${this.storage.settings.allowedExtensions.map((e) => '.' + e).join(', ')}.` }, 415);
    }

    // validate metadata before reserving anything
    const assetFields = mode.kind === 'asset' ? await validateFields(UploadAssetFieldsDto, rawFields) : undefined;
    const versionFields = mode.kind === 'version' ? await validateFields(UploadVersionFieldsDto, rawFields) : undefined;
    if (assetFields?.programId && !dbStore.programs.some((p) => p.id === assetFields.programId && p.organizationId === organizationId && !p.deletedAt)) {
      throw new BadRequestException('Program does not belong to this organization');
    }

    const assetId = mode.kind === 'asset' ? randomUUID() : target!.id;
    const versionNumber = mode.kind === 'asset' ? 1 : target!.version + 1;
    const key = this.storage.buildKey({ kind: 'asset-file', organizationId, assetId, version: versionNumber });
    const reservation = await this.quota.reserve(organizationId, reserveBytes, { purpose: mode.kind === 'asset' ? 'asset-upload' : 'version-upload', storageKey: key, createdBy: actorId });

    let stored: StoredObjectInfo | undefined;
    try {
      stored = await this.storage.uploadStream({
        key,
        body: stream,
        originalFileName: originalName,
        maxBytes: reserveBytes,
        allowedTypes: this.storage.settings.allowedFileTypes,
        organizationId,
        signal,
      });
      const info = stored;
      const result = await inTx(async (m) => {
        await this.quota.commit(m, reservation, info.sizeBytes);
        const now = new Date();
        const r = await repos(m);
        await r.objects.insert({
          id: randomUUID(), organizationId, storageKey: key, kind: 'ASSET_FILE', countsTowardQuota: true, sizeBytes: info.sizeBytes,
          checksumSha256: info.checksumSha256, contentType: info.contentType, originalFileName: originalName.slice(0, 255), assetId, createdBy: actorId, createdAt: now,
        } as StoredObject);
        if (mode.kind === 'asset') {
          const f = assetFields!;
          const tags = [...new Set((f.tags || []).map((t) => t.trim()).filter(Boolean))].slice(0, 20);
          const asset: Asset = {
            id: assetId, organizationId, programId: f.programId, name: f.name, description: f.description, assetType: f.assetType,
            sourceType: AssetSourceType.FILE, contentType: info.contentType, fileName, originalFileName: originalName.slice(0, 255),
            fileExtension: ext, mimeType: info.contentType, fileSize: info.sizeBytes, storageProvider: 's3', storageKey: key,
            tags, metadata: { folderPath: f.folderPath || 'General' }, language: f.language, country: f.country,
            status: f.status || AssetStatus.DRAFT, isPublicToAffiliates: f.isPublicToAffiliates ?? f.status === AssetStatus.PUBLISHED,
            isDownloadable: f.isDownloadable ?? true, isCopyable: f.isCopyable ?? true, version: 1, checksum: info.checksumSha256,
            createdBy: actorId, updatedBy: actorId, createdAt: now, updatedAt: now,
          } as Asset;
          await r.assets.insert(asset);
          await r.versions.insert({
            id: randomUUID(), assetId, versionNumber: 1, storageKey: key, fileName, mimeType: info.contentType, fileSize: info.sizeBytes,
            checksum: info.checksumSha256, createdBy: actorId, createdAt: now, changeNotes: 'Initial upload', isCurrent: true,
          } as AssetVersion);
          await writeAudit(m, {
            organizationId, actorId, action: 'ASSET_UPLOADED', resourceType: 'asset', resourceId: assetId, targetName: asset.name,
            after: { ...pick(asset, ASSET_AUDIT_FIELDS), sizeBytes: info.sizeBytes, contentType: info.contentType, originalFileName: originalName },
          });
          return { assetId, asset };
        }
        // new version: lock the asset row; a concurrent version upload of the same asset gets 409 (unique version)
        const [locked] = await m.query(`SELECT id, version, deletedAt FROM assets WHERE id = ? AND organizationId = ? FOR UPDATE`, [assetId, organizationId]);
        if (!locked || locked.deletedAt) throw new NotFoundException('ASSET_NOT_FOUND');
        if (Number(locked.version) !== target!.version) throw new HttpException({ statusCode: 409, code: 'VERSION_CONFLICT', message: 'Another version was uploaded at the same time. Reload and try again.' }, 409);
        const before = await r.assets.findOneByOrFail({ id: assetId });
        await r.versions.update({ assetId }, { isCurrent: false });
        await r.versions.insert({
          id: randomUUID(), assetId, versionNumber, storageKey: key, fileName, mimeType: info.contentType, fileSize: info.sizeBytes,
          checksum: info.checksumSha256, createdBy: actorId, createdAt: now, changeNotes: versionFields?.changeNotes, isCurrent: true,
        } as AssetVersion);
        await r.assets.update({ id: assetId }, {
          version: versionNumber, fileName, originalFileName: originalName.slice(0, 255), fileExtension: ext, mimeType: info.contentType,
          contentType: info.contentType, fileSize: info.sizeBytes, storageKey: key, checksum: info.checksumSha256, storageProvider: 's3',
          thumbnailUrl: null as any, width: null as any, height: null as any, updatedBy: actorId, updatedAt: now,
        });
        const after = await r.assets.findOneByOrFail({ id: assetId });
        await writeAudit(m, {
          organizationId, actorId, action: 'ASSET_VERSION_ADDED', resourceType: 'asset', resourceId: assetId, targetName: after.name,
          before: { version: before.version, fileSize: before.fileSize, checksum: before.checksum, fileName: before.fileName },
          after: { version: versionNumber, fileSize: info.sizeBytes, checksum: info.checksumSha256, fileName, changeNotes: versionFields?.changeNotes },
        });
        return { assetId, asset: after };
      });
      this.thumbnails.schedule(organizationId, assetId, key, info.fileType, info.sizeBytes);
      return result;
    } catch (err: any) {
      // never leave an object without its record, never keep reserved space for a file that was not saved
      if (stored) await this.storage.deleteObject(key, { organizationId }).catch((e) => this.logger.error(`could not delete ${key} after a failed upload: ${e?.message || e}; the cleanup job will retry`));
      await this.quota.release(reservation.id, String(err?.response?.code || err?.code || err?.name || 'failed')).catch((e) => this.logger.error(`could not release reservation ${reservation.id}: ${e?.message || e}; the cleanup job will release it`));
      throw err;
    }
  }
}
