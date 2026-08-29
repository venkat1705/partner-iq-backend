import { IsString, IsEmail, IsOptional, IsUrl, MaxLength, IsEnum, ValidateNested, IsNumber, Min, Max, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateAffiliateDto {
  @ApiProperty({ example: 'Sarah Growth' })
  @IsString()
  displayName!: string;

  @ApiProperty({ example: 'sarah@growthpartner.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'Growth Partner LLC' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ example: 'https://growthpartner.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ example: 'program_uuid_here' })
  @IsString()
  programId!: string;
}

export class PublicApplyDto {
  @ApiProperty({ example: 'org_uuid' })
  @IsString()
  organizationId!: string;

  @ApiProperty({ example: 'program_uuid' })
  @IsString()
  programId!: string;

  @ApiProperty({ example: 'john@affiliate.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'https://myblog.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({ example: 'SEO & Content Marketing' })
  @IsOptional()
  @IsString()
  promotionMethod?: string;
}

export enum AffiliateTypeCode {
  CONTENT_CREATOR = 'CONTENT_CREATOR',
  INFLUENCER = 'INFLUENCER',
  AGENCY = 'AGENCY',
  CONSULTANT = 'CONSULTANT',
  PUBLISHER = 'PUBLISHER',
  DEVELOPER = 'DEVELOPER',
  CUSTOMER = 'CUSTOMER',
  COMMUNITY = 'COMMUNITY',
  RESELLER = 'RESELLER',
  OTHER = 'OTHER',
}

export enum PrimaryChannelCode {
  YOUTUBE = 'YOUTUBE',
  INSTAGRAM = 'INSTAGRAM',
  LINKEDIN = 'LINKEDIN',
  BLOG = 'BLOG',
  NEWSLETTER = 'NEWSLETTER',
  COMMUNITY = 'COMMUNITY',
  PODCAST = 'PODCAST',
  PAID_MEDIA = 'PAID_MEDIA',
  AGENCY_CONSULTING = 'AGENCY_CONSULTING',
  COUPON = 'COUPON',
  OTHER = 'OTHER',
}

export enum InvitationCommissionType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
}

export class CommissionOverrideDto {
  @ApiProperty({ enum: InvitationCommissionType })
  @IsEnum(InvitationCommissionType)
  type!: InvitationCommissionType;

  @ApiProperty({ example: 20 })
  @IsNumber()
  @Min(1)
  @Max(100000000)
  value!: number;
}

export class CreateAffiliateInvitationDto {
  @ApiProperty({ example: 'program_uuid' })
  @IsString()
  programId!: string;

  @ApiProperty({ example: 'SaaS Review Weekly' })
  @IsString()
  @MaxLength(150)
  partnerName!: string;

  @ApiProperty({ example: 'partner@saasreview.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ enum: AffiliateTypeCode })
  @IsOptional()
  @IsEnum(AffiliateTypeCode)
  affiliateType?: AffiliateTypeCode;

  @ApiPropertyOptional({ enum: PrimaryChannelCode })
  @IsOptional()
  @IsEnum(PrimaryChannelCode)
  primaryChannel?: PrimaryChannelCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customChannel?: string;

  @ApiPropertyOptional({ type: CommissionOverrideDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CommissionOverrideDto)
  commissionOverride?: CommissionOverrideDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  personalMessage?: string;
}

export class AcceptAffiliateInvitationDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  acceptedTerms!: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  termsVersionAccepted?: number;
}
