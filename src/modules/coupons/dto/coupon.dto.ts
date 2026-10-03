import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

// Code format (A–Z 0–9 - _, 2–40 chars) is enforced in the service so the error message is specific (D3).
export class CreateCouponDto {
  @ApiPropertyOptional({ example: 'SUMMER20', description: '2–40 chars, A–Z 0–9 - _; stored uppercase.' })
  // keep the raw JSON value: implicit conversion would otherwise turn a number into a string code
  @Transform(({ obj }) => obj.code)
  @IsString()
  code!: string;

  @ApiPropertyOptional({ example: 'Summer 20% Off' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: ['PERCENTAGE', 'FIXED_AMOUNT'] })
  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  discountType!: 'PERCENTAGE' | 'FIXED_AMOUNT';

  @ApiPropertyOptional({ example: 12.5, description: 'Percent (0.01–100) or fixed amount in major units, max 2 decimals.' })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  discountValue!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  maxRedemptions?: number;

  @ApiPropertyOptional({ description: 'Uses allowed per customer (customer id, else normalized email).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxRedemptionsPerCustomer?: number;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'YYYY-MM-DD (organization timezone, start of day) or an ISO timestamp.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  validFrom?: string;

  @ApiPropertyOptional({ example: '2026-11-30', description: 'YYYY-MM-DD (organization timezone, valid through 23:59:59) or an ISO timestamp.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  validUntil?: string;

  @ApiPropertyOptional({ description: 'Affiliate IDs to assign this coupon to immediately on creation' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  affiliateIds?: string[];
}

/** `null` clears an optional limit/date; omitted fields are left unchanged. The code itself is immutable. */
export class UpdateCouponDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: ['PERCENTAGE', 'FIXED_AMOUNT'] })
  @IsOptional()
  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  discountValue?: number;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  maxRedemptions?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxRedemptionsPerCustomer?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsISO8601({ strict: true })
  validFrom?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsISO8601({ strict: true })
  validUntil?: string | null;
}

export class ChangeCouponStatusDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'] })
  @IsIn(['ACTIVE', 'PAUSED', 'ARCHIVED'])
  status!: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}

export class AssignCouponDto {
  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  affiliateIds!: string[];
}

export class UpdateCouponSettingsDto {
  @ApiPropertyOptional()
  @IsBoolean()
  couponsEnabled!: boolean;
}

/** Optional server-side paging/filtering for GET /coupons. Without `page` the legacy full array is returned. */
export class ListCouponsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED'])
  status?: string;

  @ApiPropertyOptional({ enum: ['PERCENTAGE', 'FIXED_AMOUNT'] })
  @IsOptional()
  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  discountType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  affiliateId?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'code', 'discountValue'] })
  @IsOptional()
  @IsIn(['createdAt', 'code', 'discountValue'])
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
