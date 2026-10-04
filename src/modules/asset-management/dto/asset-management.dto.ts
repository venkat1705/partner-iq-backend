import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  AffiliateAssetActivityType,
  AssetBundleStatus,
  AssetBundleVisibility,
  AssetSourceType,
  AssetStatus,
  AssetType,
} from '../../../common/enums';

/**
 * Size, storage key, URL, checksum, MIME type, uploader and timestamps are NEVER accepted from clients: files are
 * uploaded through the multipart endpoint and the server measures them. Unknown fields are rejected by the global
 * ValidationPipe (forbidNonWhitelisted).
 */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const FOLDER = /^[^\\/<>:"|?*\u0000-\u001f]{1,120}$/;

/** Metadata of a file upload (multipart form fields that precede the file part). */
export class UploadAssetFieldsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsEnum(AssetType)
  assetType!: AssetType;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(FOLDER, { message: 'folderPath may not contain / \\ < > : " | ? * or control characters' })
  folderPath?: string;

  /** JSON array or comma-separated list in multipart forms. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(12)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  country?: string;

  @IsOptional()
  @IsIn([AssetStatus.DRAFT, AssetStatus.PUBLISHED])
  status?: AssetStatus;

  @IsOptional()
  @IsBoolean()
  isPublicToAffiliates?: boolean;

  @IsOptional()
  @IsBoolean()
  isDownloadable?: boolean;

  @IsOptional()
  @IsBoolean()
  isCopyable?: boolean;
}

/** Fields of a new-version upload. */
export class UploadVersionFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  changeNotes?: string;
}

/** Non-file assets (copy text, HTML snippets, external links). Files use POST /assets/upload. */
export class CreateAssetDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsEnum(AssetType)
  assetType!: AssetType;

  @IsIn([AssetSourceType.TEXT, AssetSourceType.HTML, AssetSourceType.URL], { message: 'sourceType must be TEXT, HTML or URL; upload files with POST /assets/upload' })
  sourceType!: AssetSourceType;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @ValidateIf((o) => o.sourceType === AssetSourceType.URL)
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2000)
  externalUrl?: string;

  @ValidateIf((o) => o.sourceType === AssetSourceType.TEXT)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  textContent?: string;

  @ValidateIf((o) => o.sourceType === AssetSourceType.HTML)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  htmlContent?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(12)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  country?: string;

  @IsOptional()
  @IsIn([AssetStatus.DRAFT, AssetStatus.PUBLISHED])
  status?: AssetStatus;

  @IsOptional()
  @IsBoolean()
  isPublicToAffiliates?: boolean;

  @IsOptional()
  @IsBoolean()
  isDownloadable?: boolean;

  @IsOptional()
  @IsBoolean()
  isCopyable?: boolean;

  @IsOptional()
  @Transform(trim)
  @Matches(FOLDER, { message: 'folderPath may not contain / \\ < > : " | ? * or control characters' })
  folderPath?: string;
}

/** Editable metadata. The stored file, its size and key change only through a new version upload. */
export class UpdateAssetDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(AssetType)
  assetType?: AssetType;

  /** Rename the file affiliates download (the storage key never changes). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  programId?: string | null;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2000)
  externalUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  textContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  htmlContent?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(12)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  country?: string;

  @IsOptional()
  @IsIn([AssetStatus.DRAFT, AssetStatus.PUBLISHED])
  status?: AssetStatus;

  @IsOptional()
  @IsBoolean()
  isPublicToAffiliates?: boolean;

  @IsOptional()
  @IsBoolean()
  isDownloadable?: boolean;

  @IsOptional()
  @IsBoolean()
  isCopyable?: boolean;

  @IsOptional()
  @Transform(trim)
  @Matches(FOLDER, { message: 'folderPath may not contain / \\ < > : " | ? * or control characters' })
  folderPath?: string;
}

export const ASSET_SORT_FIELDS = ['updatedAt', 'createdAt', 'name', 'fileSize', 'assetType', 'status'] as const;

export class ListAssetsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsEnum(AssetType)
  assetType?: AssetType;

  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  folderPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tag?: string;

  @IsOptional()
  @IsIn(ASSET_SORT_FIELDS as unknown as string[])
  sortBy?: (typeof ASSET_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateAssetBundleDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  programId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  campaignId?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  coverImageAssetId?: string | null;

  @IsOptional()
  @IsIn([AssetBundleStatus.DRAFT])
  status?: AssetBundleStatus;

  @IsOptional()
  @IsEnum(AssetBundleVisibility)
  visibility?: AssetBundleVisibility;

  /** Minimum tier for PARTNER_TIER bundles (tiers belong to one program). */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  partnerTierId?: string | null;

  /** Affiliates for SPECIFIC_AFFILIATES bundles. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  affiliateIds?: string[];

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  country?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class UpdateAssetBundleDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  programId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  campaignId?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  coverImageAssetId?: string | null;

  @IsOptional()
  @IsEnum(AssetBundleVisibility)
  visibility?: AssetBundleVisibility;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  partnerTierId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  affiliateIds?: string[];

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  country?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  displayOrder?: number;
}

export class AddBundleAssetDto {
  @IsUUID()
  assetId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  displayOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  customDescription?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

export class ReorderBundleAssetsDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  assetIds!: string[];
}

export class RecordAssetActivityDto {
  @IsIn([AffiliateAssetActivityType.VIEW, AffiliateAssetActivityType.PREVIEW, AffiliateAssetActivityType.COPY, AffiliateAssetActivityType.LINK_COPY, AffiliateAssetActivityType.COUPON_COPY])
  activityType!: AffiliateAssetActivityType;

  @IsOptional()
  @IsUUID()
  bundleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class BulkAssetActionDto {
  /** ARCHIVE = move to trash. */
  @IsIn(['ARCHIVE', 'MOVE', 'TAG'])
  action!: 'ARCHIVE' | 'MOVE' | 'TAG';

  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  assetIds!: string[];

  @IsOptional()
  @Transform(trim)
  @Matches(FOLDER, { message: 'folderPath may not contain / \\ < > : " | ? * or control characters' })
  folderPath?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  tags?: string[];
}

export class DownloadQueryDto {
  @IsOptional()
  @IsUUID()
  versionId?: string;

  @IsOptional()
  @IsIn(['attachment', 'inline'])
  disposition?: 'attachment' | 'inline';
}

export class SetStorageLimitDto {
  /** Bytes; 0 blocks all uploads. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  limitBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** New version of a text / HTML / link asset (file assets get new versions only by uploading the new file). */
export class AddContentVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  changeNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  textContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  htmlContent?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2000)
  externalUrl?: string;
}
