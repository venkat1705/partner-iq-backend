import { IsString, IsNumber, IsOptional, Min, IsObject, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConversionDto {
  @ApiProperty({ example: 'ORD-10042' })
  @IsString()
  externalId!: string;

  @ApiProperty({ example: 'CUS-2001' })
  @IsString()
  customerExternalId!: string;

  @ApiProperty({ example: 19900, description: 'Amount in smallest currency unit (e.g. cents for USD)' })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ example: 'USD' })
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
