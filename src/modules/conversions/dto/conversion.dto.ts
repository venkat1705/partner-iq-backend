import { IsString, IsNumber, IsOptional, Min, IsObject, MaxLength, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../../common/constants/currency';

export class CreateConversionDto {
  @ApiProperty({ example: 'ORD-10042' })
  @IsString()
  externalId!: string;

  @ApiProperty({ example: 'CUS-2001' })
  @IsString()
  customerExternalId!: string;

  @ApiProperty({ example: 19900, description: 'Amount in paise (smallest INR unit)' })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ example: PLATFORM_CURRENCY, description: 'Must be INR — PartnerIQ processes INR only.' })
  @IsOptional()
  @IsString()
  @IsIn([PLATFORM_CURRENCY], { message: `Only ${PLATFORM_CURRENCY} is supported.` })
  currency?: string;

  @ApiPropertyOptional({ example: 'pro-plan' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ example: 'PURCHASE' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 'clk_123', description: 'The Click ID returned by the tracking redirect/browser-click API. Preferred over attributionId - it is the primary attribution identifier and survives cookie deletion when the click was later linked to this customer via /tracking/identify.' })
  @IsOptional()
  @IsString()
  clickId?: string;

  @ApiPropertyOptional({ example: 'attr_123', description: 'Legacy: an explicit attribution record id. Prefer clickId.' })
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
