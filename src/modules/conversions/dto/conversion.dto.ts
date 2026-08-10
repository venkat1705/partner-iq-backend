import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
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

  @ApiPropertyOptional({ example: '2026-08-07T10:30:00Z' })
  @IsOptional()
  @IsString()
  occurredAt?: string;
}

export class RefundConversionDto {
  @ApiPropertyOptional({ example: 'Customer requested full refund' })
  @IsOptional()
  @IsString()
  reason?: string;
}
