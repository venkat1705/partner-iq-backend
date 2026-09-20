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

export class UpdateCommissionRuleDto {
  @ApiPropertyOptional({ example: 'Gold Tier 20% US Bonus' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @ApiPropertyOptional({ example: 'ALL' })
  @IsOptional()
  @IsString()
  matchType?: 'ALL' | 'ANY';

  @ApiPropertyOptional({ enum: CommissionType, example: CommissionType.PERCENTAGE })
  @IsOptional()
  @IsEnum(CommissionType)
  commissionType?: CommissionType;

  @ApiPropertyOptional({ example: 2000, description: 'Commission value (20.00% = 2000 basis points or fixed cents)' })
  @IsOptional()
  @IsNumber()
  commissionValue?: number;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  holdPeriodDays?: number;

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

export class ListCommissionsQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;

  @ApiPropertyOptional({ example: 'ORD-94812' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'APPROVED' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'uuid-of-program' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ example: 'uuid-of-affiliate' })
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiPropertyOptional({ example: 'PERCENTAGE' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ example: 'DESC' })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC';
}

export class CommissionAnalyticsQueryDto {
  @ApiPropertyOptional({ example: '30D' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({ example: 'uuid-of-program' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ example: 'uuid-of-affiliate' })
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'day' })
  @IsOptional()
  @IsString()
  interval?: 'day' | 'week' | 'month';
}

export class ApproveCommissionDto {
  @ApiPropertyOptional({ example: 'Verified order and completed hold period' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkApproveCommissionsDto {
  @ApiProperty({ example: ['uuid-1', 'uuid-2'] })
  @IsArray()
  @IsString({ each: true })
  commissionIds!: string[];

  @ApiPropertyOptional({ example: 'Bulk monthly reconciliation approval' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectCommissionDto {
  @ApiProperty({ example: 'Fraudulent transaction detected by payment provider' })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({ example: 'Chargeback confirmation received' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AdjustCommissionDto {
  @ApiProperty({ example: 500, description: 'Adjustment in cents (can be positive or negative)' })
  @IsNumber()
  deltaAmountCents!: number;

  @ApiProperty({ example: 'Manual performance bonus' })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({ example: 'Awarded extra tier bonus for Q3 volume milestone' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ example: 'UPHOLD', enum: ['UPHOLD', 'REJECT', 'PARTIAL'] })
  @IsString()
  resolution!: 'UPHOLD' | 'REJECT' | 'PARTIAL';

  @ApiPropertyOptional({ example: 250, description: 'Optional adjustment in cents if partial/uphold' })
  @IsOptional()
  @IsNumber()
  deltaAmountCents?: number;

  @ApiProperty({ example: 'Re-reviewed order and customer attribution log' })
  @IsString()
  notes!: string;
}

