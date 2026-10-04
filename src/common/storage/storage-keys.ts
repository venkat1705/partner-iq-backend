/**
 * The ONLY place object keys are built and parsed. Change the key layout here.
 *
 *   {prefix/}orgs/{organizationId}/assets/{assetId}/v{version}/{randomId}
 *   {prefix/}orgs/{organizationId}/thumbnails/{assetId}/{size}/{randomId}
 *   {prefix/}orgs/{organizationId}/media/{purpose}/{randomId}           (logos, banners)
 *   {prefix/}users/{userId}/avatars/{randomId}                         (user-level, not organization data)
 *
 * User-supplied file names never appear in a key (they are stored in the database and used only in the
 * Content-Disposition header). Every organization object starts with orgs/{organizationId}/, so ownership can be
 * checked from the key alone.
 */
import { randomBytes } from 'crypto';
import { StorageKeyError } from './storage.errors';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PURPOSE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SIZE = /^[a-z0-9]{1,16}$/;

export type ObjectKeyRef =
  | { kind: 'asset-file'; organizationId: string; assetId: string; version: number }
  | { kind: 'asset-thumbnail'; organizationId: string; assetId: string; size: string }
  | { kind: 'org-media'; organizationId: string; purpose: string }
  | { kind: 'user-avatar'; userId: string };

function requireId(value: string, what: string) {
  if (!ID.test(value)) throw new StorageKeyError(`${what} must be a lowercase UUID to be used in a storage key.`);
}

const randomId = () => randomBytes(12).toString('hex');

export function buildObjectKey(ref: ObjectKeyRef, prefix: string): string {
  let key: string;
  switch (ref.kind) {
    case 'asset-file':
      requireId(ref.organizationId, 'organizationId');
      requireId(ref.assetId, 'assetId');
      if (!Number.isInteger(ref.version) || ref.version < 1) throw new StorageKeyError('version must be a positive integer.');
      key = `orgs/${ref.organizationId}/assets/${ref.assetId}/v${ref.version}/${randomId()}`;
      break;
    case 'asset-thumbnail':
      requireId(ref.organizationId, 'organizationId');
      requireId(ref.assetId, 'assetId');
      if (!SIZE.test(ref.size)) throw new StorageKeyError('thumbnail size label is invalid.');
      key = `orgs/${ref.organizationId}/thumbnails/${ref.assetId}/${ref.size}/${randomId()}`;
      break;
    case 'org-media':
      requireId(ref.organizationId, 'organizationId');
      if (!PURPOSE.test(ref.purpose)) throw new StorageKeyError('media purpose is invalid.');
      key = `orgs/${ref.organizationId}/media/${ref.purpose}/${randomId()}`;
      break;
    case 'user-avatar':
      requireId(ref.userId, 'userId');
      key = `users/${ref.userId}/avatars/${randomId()}`;
      break;
    default:
      throw new StorageKeyError('unknown object kind');
  }
  return prefix ? `${prefix}/${key}` : key;
}

export interface ParsedObjectKey {
  scope: 'org' | 'user';
  ownerId: string;
  /** assets | thumbnails | media | avatars */
  area: string;
}

/** Parse a key built by buildObjectKey (with the configured prefix). Returns null for anything else. */
export function parseObjectKey(key: string, prefix: string): ParsedObjectKey | null {
  if (typeof key !== 'string' || key.includes('..') || key.includes('\\')) return null;
  let rest = key;
  if (prefix) {
    if (!rest.startsWith(`${prefix}/`)) return null;
    rest = rest.slice(prefix.length + 1);
  }
  const parts = rest.split('/');
  if (parts[0] === 'orgs' && ID.test(parts[1] || '') && ['assets', 'thumbnails', 'media'].includes(parts[2])) {
    return { scope: 'org', ownerId: parts[1], area: parts[2] };
  }
  if (parts[0] === 'users' && ID.test(parts[1] || '') && parts[2] === 'avatars') {
    return { scope: 'user', ownerId: parts[1], area: parts[2] };
  }
  return null;
}

export function keyBelongsToOrganization(key: string, organizationId: string, prefix: string): boolean {
  const parsed = parseObjectKey(key, prefix);
  return Boolean(parsed && parsed.scope === 'org' && parsed.ownerId === organizationId);
}

/** Prefix under which all objects of one organization live (for listing during reconciliation). */
export function organizationPrefix(organizationId: string, prefix: string): string {
  requireId(organizationId, 'organizationId');
  return prefix ? `${prefix}/orgs/${organizationId}/` : `orgs/${organizationId}/`;
}

export function rootPrefix(prefix: string): string {
  return prefix ? `${prefix}/` : '';
}
