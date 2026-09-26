import { IsString, IsOptional, IsEnum, IsUrl, IsNumber, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationStatus } from '../../../common/enums';
import { PLATFORM_CURRENCY } from '../../../common/constants/currency';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme SaaS' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'acme-saas' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ example: 'https://acme.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({ example: 'Software' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({ example: '11-50' })
  @IsOptional()
  @IsString()
  companySize?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: PLATFORM_CURRENCY, description: 'Must be INR — PartnerIQ processes INR only.' })
  @IsOptional()
  @IsString()
  @IsIn([PLATFORM_CURRENCY], { message: `Only ${PLATFORM_CURRENCY} is supported.` })
  defaultCurrency?: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companySize?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;
}

export class OnboardingOrgDto {
  @ApiProperty({ example: 'Acme SaaS' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'acme-saas' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: 'Software' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({ example: '11-50' })
  @IsOptional()
  @IsString()
  companySize?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated key, stable for the lifetime of the onboarding form. A resubmission ' +
      '(double-click, retry, two tabs) with the same key returns the original organization ' +
      'instead of creating a duplicate.',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class OnboardingProgramDto {
  @ApiProperty({ example: 'Acme SaaS' })
  @IsString()
  organizationId!: string;

  @ApiProperty({ example: 'Acme Affiliate Program' })
  @IsString()
  programName!: string;

  @ApiProperty({ example: 15 }) // 15%
  @IsNumber()
  defaultCommissionRate!: number;
}
