import { IsString, IsEnum, IsNumber, IsOptional, Min, Max, IsArray, IsObject, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProgramType, ProgramStatus, CommissionType, AttributionModel } from '../../../common/enums';

export class CreateProgramDto {
  @ApiProperty({ example: 'Acme Affiliate Program' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'acme-affiliates' })
  @IsString()
  slug!: string;

  @ApiProperty({ enum: ProgramType, example: ProgramType.AFFILIATE })
  @IsEnum(ProgramType)
  type!: ProgramType;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: ProgramStatus, example: ProgramStatus.DRAFT })
  @IsOptional()
  @IsEnum(ProgramStatus)
  status?: ProgramStatus;

  @ApiProperty({ enum: CommissionType, example: CommissionType.PERCENTAGE })
  @IsEnum(CommissionType)
  commissionType!: CommissionType;

  @ApiProperty({ example: 1500, description: 'Default commission value (basis points or cents)' })
  @IsNumber()
  defaultCommissionValue!: number;

  @ApiPropertyOptional({ example: 15, description: 'Default commission percentage' })
  @IsOptional()
  @IsNumber()
  defaultCommissionRate?: number;

  @ApiProperty({ enum: AttributionModel, example: AttributionModel.LAST_CLICK })
  @IsEnum(AttributionModel)
  attributionModel!: AttributionModel;

  @ApiPropertyOptional({ example: 30, description: 'Number of days to look back for attribution matching' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  attributionWindowDays?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  cookieDurationDays?: number;

  @ApiPropertyOptional({ example: 'PROMO_CODE', description: 'Priority when both a click and coupon claim the same conversion.' })
  @IsOptional()
  @IsString()
  couponAttributionPriority?: 'PROMO_CODE' | 'AFFILIATE' | 'LAST_CLICK';

  @ApiPropertyOptional({ example: { weights: { google: 0.5, linkedin: 0.3, email: 0.2 } }, description: 'Custom rules for advanced attribution models.' })
  @IsOptional()
  @IsObject()
  attributionConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'AUTO' })
  @IsOptional()
  @IsString()
  affiliateApprovalMode?: 'AUTO' | 'MANUAL';

  @ApiPropertyOptional({ example: 'Earn recurring commissions by referring teams.' })
  @IsOptional()
  @IsString()
  shortDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'SAAS' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: ['B2B', 'Productivity'] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ example: 'https://acme.com' })
  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @ApiPropertyOptional({ example: 'https://acme.com/pricing' })
  @IsOptional()
  @IsUrl()
  landingUrl?: string;

  @ApiPropertyOptional({ example: 'PUBLIC' })
  @IsOptional()
  @IsString()
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumPayoutAmount?: number;

  @ApiPropertyOptional({ example: 'MONTHLY' })
  @IsOptional()
  @IsString()
  payoutSchedule?: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'MANUAL';

  @ApiPropertyOptional({ example: '1st' })
  @IsOptional()
  @IsString()
  payoutDay?: string;

  @ApiPropertyOptional({ example: ['Bank Transfer', 'UPI'] })
  @IsOptional()
  @IsArray()
  payoutMethods?: string[];

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/demo/image/upload/v1/programs/logo.png' })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/demo/image/upload/v1/programs/banner.png' })
  @IsOptional()
  @IsUrl()
  bannerUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  policy?: Record<string, unknown>;
}

export class UpdateProgramDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  defaultCommissionValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(CommissionType)
  commissionType?: CommissionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(AttributionModel)
  attributionModel?: AttributionModel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  attributionWindowDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cookieDurationDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  couponAttributionPriority?: 'PROMO_CODE' | 'AFFILIATE' | 'LAST_CLICK';

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  attributionConfig?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumPayoutAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payoutSchedule?: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'MANUAL';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payoutDay?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  payoutMethods?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  bannerUrl?: string;

  @ApiPropertyOptional({ example: 'PUBLIC' })
  @IsOptional()
  @IsString()
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shortDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  landingUrl?: string;
}
