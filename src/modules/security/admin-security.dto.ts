import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum, IsNumber, IsObject } from 'class-validator';

export class CreateSecurityRuleDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsNotEmpty()
  severity!: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsString()
  @IsOptional()
  status?: 'ACTIVE' | 'DISABLED' | 'DRY_RUN';

  @IsObject()
  conditions!: any;

  @IsArray()
  actions!: string[];
}

export class UpdateSecurityRuleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  severity?: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsString()
  @IsOptional()
  status?: 'ACTIVE' | 'DISABLED' | 'DRY_RUN';

  @IsObject()
  @IsOptional()
  conditions?: any;

  @IsArray()
  @IsOptional()
  actions?: string[];

  @IsString()
  @IsOptional()
  changeReason?: string;
}

export class TestRuleSimulationDto {
  @IsObject()
  conditions!: any;

  @IsArray()
  @IsOptional()
  actions?: string[];

  @IsNumber()
  @IsOptional()
  samplePeriodDays?: number;
}

export class CreateInvestigationDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  severity!: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsString()
  @IsOptional()
  alertId?: string;

  @IsString()
  @IsOptional()
  organizationId?: string;

  @IsString()
  @IsOptional()
  actorId?: string;

  @IsString()
  @IsOptional()
  actorEmail?: string;

  @IsString()
  @IsOptional()
  resourceType?: string;

  @IsString()
  @IsOptional()
  resourceId?: string;

  @IsString()
  @IsOptional()
  assignedTo?: string;

  @IsString()
  @IsOptional()
  securityImpact?: string;

  @IsString()
  @IsOptional()
  initialNotes?: string;
}

export class ResolveInvestigationDto {
  @IsString()
  @IsNotEmpty()
  outcome!: 'CONFIRMED_SECURITY_INCIDENT' | 'FALSE_POSITIVE' | 'NO_ISSUE' | 'CONTAINED' | 'INCONCLUSIVE';

  @IsString()
  @IsNotEmpty()
  resolutionReason!: string;

  @IsString()
  @IsOptional()
  actionsTaken?: string;
}

export class CreateIncidentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  category!: string;

  @IsString()
  @IsNotEmpty()
  severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsString()
  @IsOptional()
  assignedOwner?: string;

  @IsArray()
  @IsOptional()
  affectedOrganizations?: any[];

  @IsArray()
  @IsOptional()
  affectedUsers?: any[];

  @IsArray()
  @IsOptional()
  affectedResources?: any[];

  @IsString()
  @IsOptional()
  securityImpact?: string;

  @IsString()
  @IsOptional()
  containmentAction?: string;

  @IsString()
  @IsOptional()
  remediationAction?: string;
}

export class ResolveIncidentDto {
  @IsString()
  @IsNotEmpty()
  outcome!: string;

  @IsString()
  @IsNotEmpty()
  resolutionReason!: string;
}

export class RevokeSessionDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class RevokeAllUserSessionsDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class ExportSecurityQueryDto {
  @IsString()
  @IsOptional()
  period?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  severity?: string;

  @IsString()
  @IsOptional()
  type?: string;
}

