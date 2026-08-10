import { IsString, IsEnum, IsNumber, IsOptional, Min, Max } from 'class-validator';
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

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  cookieDurationDays?: number;

  @ApiPropertyOptional({ example: 'AUTO' })
  @IsOptional()
  @IsString()
  affiliateApprovalMode?: 'AUTO' | 'MANUAL';
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
  cookieDurationDays?: number;
}
