import { IsEmail, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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
