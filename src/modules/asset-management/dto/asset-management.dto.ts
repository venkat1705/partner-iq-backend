import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  AffiliateAssetActivityType,
  AssetBundleStatus,
  AssetBundleVisibility,
  AssetSourceType,
  AssetStatus,
  AssetType,
} from '../../../common/enums';

export class CreateUploadUrlDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(120)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(200 * 1024 * 1024)
  fileSize!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string;
}

export class CreateAssetDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsEnum(AssetType)
  assetType!: AssetType;

  @IsEnum(AssetSourceType)
  sourceType!: AssetSourceType;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @ValidateIf((dto) => [AssetSourceType.URL, AssetSourceType.GENERATED].includes(dto.sourceType))
  @IsUrl({ require_protocol: true })
  externalUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  textContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  htmlContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalFileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  storageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  storageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
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
  @IsEnum(AssetStatus)
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

export class UpdateAssetDto extends CreateAssetDto {
  @IsOptional()
  name!: string;

  @IsOptional()
  assetType!: AssetType;

  @IsOptional()
  sourceType!: AssetSourceType;
}

export class AddAssetVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  fileSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  storageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  storageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  changeNotes?: string;
}

export class ListAssetsQueryDto {
  @IsOptional()
  @IsString()
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
  language?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsInt()
  page?: number;

  @IsOptional()
  @IsInt()
  limit?: number;
}

export class CreateAssetBundleDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  campaignId?: string;

  @IsOptional()
  @IsUUID()
  coverImageAssetId?: string;

  @IsOptional()
  @IsEnum(AssetBundleStatus)
  status?: AssetBundleStatus;

  @IsOptional()
  @IsEnum(AssetBundleVisibility)
  visibility?: AssetBundleVisibility;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class UpdateAssetBundleDto extends CreateAssetBundleDto {
  @IsOptional()
  name!: string;
}

export class AddBundleAssetDto {
  @IsUUID()
  assetId!: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customDescription?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

export class ReorderBundleAssetsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class RecordAssetActivityDto {
  @IsEnum(AffiliateAssetActivityType)
  activityType!: AffiliateAssetActivityType;

  @IsOptional()
  @IsUUID()
  bundleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
