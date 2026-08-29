import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  IsArray,
} from 'class-validator';
import {
  TierEvaluationPeriod,
  TierDowngradeMode,
  CommissionRateEffectiveStrategy,
  GamificationMetric,
} from '../../../common/enums';

export class TierConditionDto {
  @IsEnum(GamificationMetric)
  metric!: GamificationMetric;

  @IsString()
  @IsNotEmpty()
  operator!: string; // 'GREATER_THAN_OR_EQUAL' | 'GREATER_THAN' | 'EQUAL' | 'BETWEEN'

  @IsNumber()
  @Min(0)
  value!: number;

  @IsNumber()
  @IsOptional()
  secondaryValue?: number;

  @IsString()
  @IsOptional()
  aggregationPeriod?: string;
}

export class CreatePartnerTierDto {
  @IsString()
  @IsOptional()
  programId?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(1)
  level!: number;

  @IsNumber()
  @IsOptional()
  displayOrder?: number;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  badge?: string;

  @IsString()
  @IsOptional()
  colorToken?: string;

  @IsEnum(TierEvaluationPeriod)
  @IsOptional()
  evaluationPeriod?: TierEvaluationPeriod;

  @IsEnum(TierDowngradeMode)
  @IsOptional()
  downgradeMode?: TierDowngradeMode;

  @IsNumber()
  @Min(0)
  @Max(365)
  @IsOptional()
  gracePeriodDays?: number;

  @IsEnum(CommissionRateEffectiveStrategy)
  @IsOptional()
  commissionRateEffectiveStrategy?: CommissionRateEffectiveStrategy;

  @IsNumber()
  @Min(0)
  @Max(10000)
  @IsOptional()
  commissionRateOverride?: number; // In basis points: 2000 = 20.00%

  @IsNumber()
  @Min(0)
  @IsOptional()
  fixedCommissionOverride?: number; // In cents

  @IsOptional()
  conditions?: {
    matchType?: 'ALL' | 'ANY';
    rules?: TierConditionDto[];
    minimumConversions?: number;
    minimumRevenue?: number;
    minimumQualifiedLeads?: number;
    minimumClosedWonDeals?: number;
    minimumCommissionEarned?: number;
  };

  @IsOptional()
  rewardsConfig?: {
    bonusAmount?: number; // Cents
    badgeName?: string;
    assetBundleIds?: string[];
    campaignAccessIds?: string[];
    couponTemplate?: string;
    notificationTitle?: string;
    notificationBody?: string;
  };

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isVisibleToAffiliate?: boolean;
}

export class UpdatePartnerTierDto extends CreatePartnerTierDto {}

export class AssignTierDto {
  @IsString()
  @IsNotEmpty()
  tierId!: string;

  @IsString()
  @IsOptional()
  programId?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  lockTier?: boolean;
}

export class LockTierDto {
  @IsBoolean()
  locked!: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class ReorderTiersDto {
  @IsArray()
  @IsString({ each: true })
  tierIds!: string[];
}
