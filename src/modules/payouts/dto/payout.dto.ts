import { IsArray, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePayoutBatchDto {
  @ApiPropertyOptional({ example: ['affiliate_uuid_1', 'affiliate_uuid_2'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  affiliateIds?: string[];

  @ApiPropertyOptional({ example: 'RAZORPAY', description: 'Disbursement gateway (RAZORPAY, CASHFREE, or MANUAL)' })
  @IsOptional()
  @IsString()
  gateway?: string;
}

export class ProcessPayoutBatchDto {
  @ApiPropertyOptional({ example: 'RAZORPAY', description: 'Disbursement gateway (RAZORPAY, CASHFREE, or MANUAL)' })
  @IsOptional()
  @IsString()
  gateway?: string;
}

