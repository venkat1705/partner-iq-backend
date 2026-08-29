import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';
import { GamificationMetric } from '../../../common/enums';

export class QueryPerformanceDto {
  @IsString()
  @IsOptional()
  programId?: string;

  @IsString()
  @IsOptional()
  periodType?: string;

  @IsString()
  @IsOptional()
  periodKey?: string;
}

export class LeaderboardQueryDto {
  @IsString()
  @IsOptional()
  programId?: string;

  @IsEnum(GamificationMetric)
  @IsOptional()
  metric?: GamificationMetric;

  @IsString()
  @IsOptional()
  period?: string; // 'MONTHLY' | 'QUARTERLY' | 'LIFETIME'

  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number;
}

export class ChangeTierDto {
  @IsString()
  @IsNotEmpty()
  newTierId!: string;

  @IsString()
  @IsOptional()
  programId?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  effectiveDate?: string | Date;
}
