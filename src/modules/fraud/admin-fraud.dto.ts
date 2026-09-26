import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateFraudRuleDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsString()
  @IsNotEmpty()
  severity!: string;

  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'DISABLED' | 'DRY_RUN';

  @IsNotEmpty()
  conditions!: any;

  @IsNotEmpty()
  actions!: any;
}

export class UpdateFraudRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  status?: 'ACTIVE' | 'DISABLED' | 'DRY_RUN';

  @IsOptional()
  conditions?: any;

  @IsOptional()
  actions?: any;
}

export class TestRuleSimulationDto {
  @IsNotEmpty()
  conditions!: any;

  @IsOptional()
  @IsString()
  period?: string;
}

export class AssignAlertDto {
  @IsString()
  @IsNotEmpty()
  assignedTo!: string;
}

export class ResolveAlertDto {
  @IsString()
  @IsNotEmpty()
  status!: 'RESOLVED' | 'DISMISSED';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateInvestigationDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  affiliateId?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsArray()
  alertIds?: string[];

  @IsOptional()
  @IsArray()
  conversionIds?: string[];

  @IsOptional()
  @IsArray()
  commissionIds?: string[];

  @IsOptional()
  @IsArray()
  payoutIds?: string[];

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInvestigationStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: 'OPEN' | 'INVESTIGATING' | 'ACTION_REQUIRED' | 'RESOLVED' | 'CLOSED';

  @IsOptional()
  @IsString()
  note?: string;
}

export class ResolveInvestigationDto {
  @IsString()
  @IsNotEmpty()
  outcome!: 'NO_ISSUE' | 'SUSPICIOUS' | 'CONFIRMED_FRAUD' | 'FALSE_POSITIVE' | 'INCONCLUSIVE';

  @IsString()
  @IsNotEmpty()
  outcomeReason!: string;

  @IsString()
  @IsNotEmpty()
  actionTaken!: string;

  @IsOptional()
  releaseHolds?: boolean;
}

export class AddInvestigationNoteDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}

export class CreateFraudHoldDto {
  @IsString()
  @IsNotEmpty()
  entityType!: 'CONVERSION' | 'COMMISSION' | 'PAYOUT';

  @IsString()
  @IsNotEmpty()
  entityId!: string;

  @IsNumber()
  amountPaise!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  alertId?: string;

  @IsOptional()
  @IsString()
  investigationId?: string;
}

export class ReleaseFraudHoldDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class UpdateAffiliateRiskStatusDto {
  @IsString()
  @IsNotEmpty()
  status!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

