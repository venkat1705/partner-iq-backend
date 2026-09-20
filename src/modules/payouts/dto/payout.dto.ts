import { IsArray, IsString, IsOptional, IsNumber, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutStatus } from '../../../common/enums';

export class CreatePayoutBatchDto {
  @ApiPropertyOptional({ example: ['affiliate_uuid_1', 'affiliate_uuid_2'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  affiliateIds?: string[];

  @ApiPropertyOptional({ example: 'RAZORPAY', description: 'Disbursement gateway (RAZORPAY, CASHFREE, or DIRECT)' })
  @IsOptional()
  @IsString()
  gateway?: string;

  @ApiPropertyOptional({ example: 'Monthly affiliate settlement run' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ProcessPayoutBatchDto {
  @ApiPropertyOptional({ example: 'RAZORPAY', description: 'Disbursement gateway (RAZORPAY, CASHFREE, or DIRECT)' })
  @IsOptional()
  @IsString()
  gateway?: string;
}

export class ListPayoutsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Search by partner name, email, ID, or provider reference' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: PayoutStatus })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by gateway (e.g. RazorpayX, Cashfree Payouts, Direct Bank Transfer)' })
  @IsOptional()
  @IsString()
  gateway?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class PayoutAnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d', '12m', 'all'], default: '30d' })
  @IsOptional()
  @IsString()
  period?: string = '30d';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class ValidateBatchDto {
  @ApiPropertyOptional({ example: ['affiliate_uuid_1', 'affiliate_uuid_2'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  affiliateIds?: string[];

  @ApiPropertyOptional({ example: 'RAZORPAY' })
  @IsOptional()
  @IsString()
  gateway?: string;
}

export class RetryPayoutItemDto {
  @ApiPropertyOptional({ example: 'Beneficiary IFSC updated' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CancelBatchDto {
  @ApiPropertyOptional({ example: 'Incorrect batch parameters' })
  @IsOptional()
  @IsString()
  reason?: string;
}
