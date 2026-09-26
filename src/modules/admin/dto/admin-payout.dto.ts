import { IsOptional, IsString, IsNumber, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class AdminPayoutListQueryDto {
  @ApiPropertyOptional({ description: 'Search term for payout ID, batch, affiliate, organization, reference, or UTR' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Organization ID filter' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Program ID filter' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ description: 'Affiliate ID filter' })
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiPropertyOptional({ description: 'Payout status filter' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Reconciliation status filter' })
  @IsOptional()
  @IsString()
  reconciliationStatus?: string;

  @ApiPropertyOptional({ description: 'Payment gateway / provider filter' })
  @IsOptional()
  @IsString()
  gateway?: string;

  @ApiPropertyOptional({ description: 'Currency code filter (e.g. INR, USD, EUR)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Start date filter (ISO string)' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End date filter (ISO string)' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Minimum amount filter in base currency units' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minAmount?: number;

  @ApiPropertyOptional({ description: 'Maximum amount filter in base currency units' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxAmount?: number;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: 'Sort field' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ description: 'Sort order', enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class AdminHoldPayoutDto {
  @ApiProperty({ description: 'Reason for placing payout on hold' })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({ description: 'Compliance note or context' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AdminRetryPayoutDto {
  @ApiPropertyOptional({ description: 'Client-supplied idempotency key for safe retry' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Administrative note explaining retry' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AdminCancelPayoutDto {
  @ApiProperty({ description: 'Reason for cancellation' })
  @IsString()
  reason!: string;
}

export class AdminResolveReconciliationDto {
  @ApiProperty({
    description: 'Resolution method',
    enum: ['MATCHED', 'WAIVED', 'MANUALLY_VERIFIED', 'FORCE_RECONCILE'],
  })
  @IsIn(['MATCHED', 'WAIVED', 'MANUALLY_VERIFIED', 'FORCE_RECONCILE'])
  resolution!: 'MATCHED' | 'WAIVED' | 'MANUALLY_VERIFIED' | 'FORCE_RECONCILE';

  @ApiProperty({ description: 'Mandatory justification for manual matching/resolution' })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({ description: 'External provider verification reference or note' })
  @IsOptional()
  @IsString()
  referenceNote?: string;
}

