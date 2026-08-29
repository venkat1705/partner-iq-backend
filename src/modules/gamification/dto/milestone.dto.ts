import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import {
  GamificationMetric,
  MilestoneRewardType,
  MilestoneResetBehavior,
} from '../../../common/enums';

export class CreateMilestoneDto {
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

  @IsEnum(GamificationMetric)
  metric!: GamificationMetric;

  @IsString()
  @IsOptional()
  operator?: string; // 'GREATER_THAN_OR_EQUAL' | 'GREATER_THAN' | 'EQUAL' | 'BETWEEN'

  @IsNumber()
  @Min(1)
  targetValue!: number;

  @IsNumber()
  @IsOptional()
  secondaryValue?: number;

  @IsString()
  @IsOptional()
  period?: string; // 'LIFETIME' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ROLLING_30_DAYS'

  @IsEnum(MilestoneResetBehavior)
  @IsOptional()
  resetBehavior?: MilestoneResetBehavior;

  @IsBoolean()
  @IsOptional()
  isRepeatable?: boolean;

  @IsNumber()
  @IsOptional()
  repeatInterval?: number;

  @IsEnum(MilestoneRewardType)
  @IsOptional()
  rewardType?: MilestoneRewardType;

  @IsOptional()
  rewardConfig?: {
    bonusAmount?: number; // Cents
    upgradeToTierId?: string;
    commissionRateOverride?: number; // Basis points
    badgeName?: string;
    badgeIcon?: string;
    assetBundleId?: string;
    couponDiscountPercent?: number;
    notificationTitle?: string;
    notificationBody?: string;
    emailSubject?: string;
    emailBody?: string;
    rewards?: Array<{
      type: MilestoneRewardType;
      config: Record<string, any>;
    }>;
  };

  @IsString()
  @IsOptional()
  badgeIcon?: string;

  @IsString()
  @IsOptional()
  badgeName?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsNumber()
  @IsOptional()
  displayOrder?: number;

  @IsOptional()
  startDate?: string | Date;

  @IsOptional()
  endDate?: string | Date;
}

export class UpdateMilestoneDto extends CreateMilestoneDto {}

export class GrantRewardDto {
  @IsString()
  @IsNotEmpty()
  rewardType!: string;

  @IsOptional()
  rewardConfig!: Record<string, any>;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
