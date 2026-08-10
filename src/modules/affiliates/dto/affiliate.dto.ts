import { IsString, IsEmail, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
