import { IsString, IsNumber, IsEnum, IsOptional, IsArray, ValidateNested, Min, Max, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommissionType } from '../../../common/enums';
import { Type } from 'class-transformer';

export class CommissionRuleConditionDto {
  @ApiProperty({ example: 'country' })
  @IsString()
  field!: string;

  @ApiProperty({ example: 'EQUALS' })
  @IsString()
  operator!: string;

  @ApiProperty({ example: 'IN' })
  value!: any;
}

export class CommissionRuleActionDto {
  @ApiProperty({ enum: CommissionType, example: CommissionType.PERCENTAGE })
  @IsEnum(CommissionType)
  commissionType!: CommissionType;

  @ApiProperty({ example: 18 })
  @IsNumber()
  @Min(0)
  commissionValue!: number;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  holdPeriodDays?: number;
}

export class CreateCommissionRuleDto {
  @ApiProperty({ example: 'Gold Tier 20% US Bonus' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'program_uuid' })
  @ValidateIf((_, value) => value !== undefined && value !== null && value !== '')
  @IsString()
  programId?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  priority!: number;

  @ApiPropertyOptional({ example: 'ALL' })
  @IsOptional()
  @IsString()
  matchType?: 'ALL' | 'ANY';

  @ApiProperty({ enum: CommissionType, example: CommissionType.PERCENTAGE })
  @IsEnum(CommissionType)
  commissionType!: CommissionType;

  @ApiProperty({ example: 2000, description: 'Commission value (20.00% = 2000 basis points or fixed cents)' })
  @IsNumber()
  commissionValue!: number;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  holdPeriodDays?: number;

  @ApiPropertyOptional({ type: CommissionRuleActionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CommissionRuleActionDto)
  action?: CommissionRuleActionDto;

  @ApiPropertyOptional({
    example: {
      all: [
        { field: 'country', operator: 'eq', value: 'US' },
        { field: 'fraudScore', operator: 'lt', value: 30 },
      ],
    },
  })
  @IsOptional()
  conditions?: any;

  @ApiPropertyOptional({ type: [CommissionRuleConditionDto] })
  @IsOptional()
  @IsArray()
  conditionList?: Array<{ field: string; operator: string; value: any }>;

  @ApiPropertyOptional({ example: 'ACTIVE' })
  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}

export class TestCommissionRulesDto {
  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 'PREMIUM' })
  @IsOptional()
  @IsString()
  productTier?: string;

  @ApiPropertyOptional({ example: 60000000 })
  @IsOptional()
  @IsNumber()
  monthlyRevenue?: number;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  fraudRiskScore?: number;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @IsNumber()
  conversionAmount?: number;
}
