import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { BillingInterval, BillingResourceType } from '../enums/billing.enums';

/**
 * A line in an add-on purchase.
 *
 * Note there is deliberately no price field: unit prices come from the
 * `billing_addons` catalog on the server. A client can only choose *which*
 * add-on and *how many*.
 */
export class AddonItemDto {
  @ApiProperty({ description: 'Catalog id of the add-on being purchased.' })
  @IsUUID()
  addonId!: string;

  @ApiProperty({ minimum: 1, maximum: 10_000, description: 'Units of capacity to add.' })
  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;
}

export class PreviewAddonDto {
  @ApiProperty({ type: [AddonItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AddonItemDto)
  items!: AddonItemDto[];
}

export class PurchaseAddonDto extends PreviewAddonDto {
  @ApiPropertyOptional({ description: 'Customer acknowledgement of the quoted recurring amount.' })
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;
}

export class UpdateAddonQuantityDto {
  @ApiProperty({ minimum: 0, description: 'New quantity. Increases must go through checkout.' })
  @IsInt()
  @Min(0)
  @Max(10_000)
  quantity!: number;
}

export class CancelAddonDto {
  @ApiPropertyOptional({ description: 'Release capacity immediately instead of at period end.' })
  @IsOptional()
  @IsBoolean()
  immediate?: boolean;
}

export class ChangePlanDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiProperty({ enum: BillingInterval })
  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;
}

// ---------------------------------------------------------------------------
// Admin configuration
// ---------------------------------------------------------------------------

export class UpdatePlanLimitDto {
  @ApiProperty({ enum: BillingResourceType })
  @IsEnum(BillingResourceType)
  resourceType!: BillingResourceType;

  @ApiPropertyOptional({
    description: 'Included allowance. Omit or send null for unlimited.',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  includedLimit?: number | null;

  @ApiPropertyOptional({ description: 'Whether extra capacity may be bought as an add-on.' })
  @IsOptional()
  @IsBoolean()
  addonPurchasable?: boolean;
}

export class UpdatePlanConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Price in the currency minor unit (paise for INR).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  trialDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ type: [UpdatePlanLimitDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePlanLimitDto)
  limits?: UpdatePlanLimitDto[];

  @ApiPropertyOptional({ description: 'Feature flags, keyed by feature code.' })
  @IsOptional()
  features?: Record<string, boolean>;
}

export class UpdateAddonConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Unit price in the currency minor unit (paise for INR).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  unitsPerQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  minQuantity?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantity?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBillingTaxDto {
  @ApiPropertyOptional({ description: 'Tax rate in basis points. 1800 = 18%.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  rateBasisPoints?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
