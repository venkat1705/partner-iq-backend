import {
  IsString,
  IsUrl,
  IsOptional,
  MaxLength,
  IsNumber,
  Min,
  IsIn,
  IsArray,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrackingLinkStatus } from '../../../common/enums';

export class CreateTrackingLinkDto {
  @ApiPropertyOptional({ example: 'program_uuid' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ example: 'affiliate_uuid' })
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiProperty({ example: 'https://acme.com/pricing' })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'destinationUrl must be a valid http:// or https:// URL' },
  )
  destinationUrl!: string;

  @ApiPropertyOptional({ example: 'summer2026' })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({ example: 'sarah' })
  @IsOptional()
  @IsString()
  customCode?: string;

  @ApiPropertyOptional({ example: 'affiliate_network' })
  @IsOptional()
  @IsString()
  utmSource?: string;

  @ApiPropertyOptional({ example: 'cpc' })
  @IsOptional()
  @IsString()
  utmMedium?: string;

  @ApiPropertyOptional({ example: 'launch_promo' })
  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmContent?: string;

  @ApiPropertyOptional({ example: { source_platform: 'youtube' } })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, string>;

  @ApiPropertyOptional({ example: 'Official launch campaign partner link' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z' })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class UpdateTrackingLinkDto {
  @ApiPropertyOptional({ example: 'https://acme.com/new-landing' })
  @IsOptional()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'destinationUrl must be a valid http:// or https:// URL' },
  )
  destinationUrl?: string;

  @ApiPropertyOptional({ enum: TrackingLinkStatus })
  @IsOptional()
  @IsString()
  status?: TrackingLinkStatus;

  @ApiPropertyOptional({ example: 'affiliate_network' })
  @IsOptional()
  @IsString()
  utmSource?: string;

  @ApiPropertyOptional({ example: 'cpc' })
  @IsOptional()
  @IsString()
  utmMedium?: string;

  @ApiPropertyOptional({ example: 'launch_promo' })
  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmContent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z' })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class ListTrackingLinksQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Search by short code, campaign, destination, affiliate, or program' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED', 'ALL'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: ['HEALTHY', 'DEGRADED', 'BROKEN', 'INACTIVE', 'ALL'] })
  @IsOptional()
  @IsString()
  healthStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmMedium?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class TrackingLinkAnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d', 'all'], default: '30d' })
  @IsOptional()
  @IsString()
  period?: string = '30d';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class BulkUpdateTrackingLinksDto {
  @ApiProperty({ example: ['link_uuid_1', 'link_uuid_2'] })
  @IsArray()
  @IsString({ each: true })
  linkIds!: string[];

  @ApiProperty({ enum: ['ACTIVATE', 'DEACTIVATE', 'ARCHIVE', 'DELETE'] })
  @IsIn(['ACTIVATE', 'DEACTIVATE', 'ARCHIVE', 'DELETE'])
  action!: 'ACTIVATE' | 'DEACTIVATE' | 'ARCHIVE' | 'DELETE';
}

export class ValidateDestinationUrlDto {
  @ApiProperty({ example: 'https://acme.com/pricing' })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'url must be a valid http:// or https:// URL' },
  )
  url!: string;
}

export class BrowserClickDto {
  @ApiProperty({ example: 'pi_pub_live_xxxx' })
  @IsString()
  publicKey!: string;

  @ApiProperty({ example: 'sarah' })
  @IsString()
  shortCode!: string;

  @ApiPropertyOptional({ example: 'anon_123456789' })
  @IsOptional()
  @IsString()
  anonymousId?: string;

  @ApiPropertyOptional({ example: 'https://acme.com/pricing?utm_source=newsletter' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  landingUrl?: string;

  @ApiPropertyOptional({ example: 'newsletter' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmSource?: string;

  @ApiPropertyOptional({ example: 'email' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmMedium?: string;

  @ApiPropertyOptional({ example: 'summer_sale' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmCampaign?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmContent?: string;
}

export class IdentifyCustomerDto {
  @ApiProperty({ example: 'pi_pub_live_xxxx' })
  @IsString()
  publicKey!: string;

  @ApiProperty({ example: 'anon_123456789' })
  @IsString()
  anonymousId!: string;

  @ApiProperty({ example: 'CUS-10042' })
  @IsString()
  customerExternalId!: string;
}
