import { IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { DEAL_BOARD_COLUMNS } from '../deal-stage.constants';
import type { DealBoardColumn } from '../deal-stage.constants';
import { PLATFORM_CURRENCY } from '../../../common/constants/currency';

export class CreatePartnerDealDto {
  @IsUUID()
  programId!: string;

  @IsOptional()
  @IsUUID()
  affiliateId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsString()
  companyName!: string;

  @IsOptional()
  @IsString()
  companyWebsite?: string;

  @IsOptional()
  @IsString()
  contactFirstName?: string;

  @IsOptional()
  @IsString()
  contactLastName?: string;

  @IsEmail()
  contactEmail!: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactJobTitle?: string;

  @IsNumber()
  @Min(0)
  estimatedValue!: number;

  @IsOptional()
  @IsString()
  @IsIn([PLATFORM_CURRENCY], { message: `Only ${PLATFORM_CURRENCY} is supported.` })
  currency?: string;

  @IsOptional()
  @IsString()
  expectedCloseDate?: string;

  @IsOptional()
  @IsString()
  opportunityDescription?: string;

  @IsOptional()
  @IsString()
  referralSource?: string;
}

export class RejectPartnerDealDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateDealStageDto {
  @IsIn(DEAL_BOARD_COLUMNS)
  column!: DealBoardColumn;

  @IsOptional()
  @IsNumber()
  @Min(0)
  actualValue?: number;
}
