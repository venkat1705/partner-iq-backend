import { IsString, IsNumber, IsOptional, Min, IsObject, MaxLength, IsIn, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../../common/constants/currency';
import { ConversionStatus } from '../../../common/enums';

export class CreateConversionDto {
  @ApiProperty({ example: 'ORD-10042' })
  @IsString()
  externalId!: string;

  @ApiProperty({ example: 'CUS-2001' })
  @IsString()
  customerExternalId!: string;

  @ApiProperty({ example: 19900, description: 'Amount in paise / cents' })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ example: PLATFORM_CURRENCY })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'pro-plan' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ example: 'PURCHASE' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 'clk_123' })
  @IsOptional()
  @IsString()
  clickId?: string;

  @ApiPropertyOptional({ example: 'attr_123' })
  @IsOptional()
  @IsString()
  attributionId?: string;

  @ApiPropertyOptional({ example: { plan: 'PRO' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '2026-08-07T10:30:00Z' })
  @IsOptional()
  @IsString()
  occurredAt?: string;

  @ApiPropertyOptional({ example: 'SDK' })
  @IsOptional()
  @IsString()
  source?: string;
}

export class RefundConversionDto {
  @ApiPropertyOptional({ example: 'RFND-10042' })
  @IsOptional()
  @IsString()
  refundExternalId?: string;

  @ApiPropertyOptional({ example: 19900 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({ example: 'Customer requested full refund' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListConversionsQueryDto {
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

  @ApiPropertyOptional({ description: 'Search by conversion ID, external order ID, customer ID, or partner name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ConversionStatus })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Validation status filter (VALID, PENDING, REJECTED)' })
  @IsOptional()
  @IsString()
  validationStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attributionModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;

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

export class ConversionAnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d', 'all'], default: '30d' })
  @IsOptional()
  @IsString()
  period?: string = '30d';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class ApproveConversionDto {
  @ApiPropertyOptional({ example: 'Verified valid order fulfillment' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectConversionDto {
  @ApiProperty({ example: 'SUSPICIOUS_ORDER: Returned or fraudulent charge' })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({ example: 'Customer chargeback initiated within 24h' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkApproveConversionsDto {
  @ApiProperty({ example: ['conv_uuid_1', 'conv_uuid_2'] })
  @IsArray()
  @IsString({ each: true })
  conversionIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateManualConversionDto {
  @ApiProperty({ example: 'program_uuid_1' })
  @IsString()
  programId!: string;

  @ApiPropertyOptional({ example: 'affiliate_uuid_1' })
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiProperty({ example: 'MANUAL-ORD-9021' })
  @IsString()
  externalId!: string;

  @ApiProperty({ example: 'CUS-4812' })
  @IsString()
  customerExternalId!: string;

  @ApiProperty({ example: 45000, description: 'Amount in cents / paise' })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ example: PLATFORM_CURRENCY })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'custom-package' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ example: 'MANUAL' })
  @IsOptional()
  @IsString()
  source?: string = 'MANUAL';

  @ApiPropertyOptional({ example: 'Phone order converted by VIP partner' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: '2026-09-20T10:00:00Z' })
  @IsOptional()
  @IsString()
  occurredAt?: string;
}
