import { IsString, IsOptional, IsEnum, IsUrl, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationStatus } from '../../../common/enums';

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

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
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
