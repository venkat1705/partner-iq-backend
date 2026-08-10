import { IsString, IsNumber, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommissionType } from '../../../common/enums';

export class CreateCommissionRuleDto {
  @ApiProperty({ example: 'Gold Tier 20% US Bonus' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'program_uuid' })
  @IsString()
  programId!: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  priority!: number;

  @ApiProperty({ enum: CommissionType, example: CommissionType.PERCENTAGE })
  @IsEnum(CommissionType)
  commissionType!: CommissionType;

  @ApiProperty({ example: 2000, description: 'Commission value (20.00% = 2000 basis points or fixed cents)' })
  @IsNumber()
  commissionValue!: number;

  @ApiPropertyOptional({
    example: {
      all: [
        { field: 'country', operator: 'eq', value: 'US' },
        { field: 'fraudScore', operator: 'lt', value: 30 },
      ],
    },
  })
  @IsOptional()
  conditions?: any;
}
