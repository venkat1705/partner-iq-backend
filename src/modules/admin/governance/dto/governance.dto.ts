export class CreateGovernancePolicyDto {
  key!: string;
  name!: string;
  description?: string;
  category!: string;
  scope?: string;
  enforcementMode!: string;
  riskLevel?: string;
  configuration!: Record<string, any>;
  changeReason?: string;
}

export class UpdateGovernancePolicyDto {
  name?: string;
  description?: string;
  enforcementMode?: string;
  riskLevel?: string;
  status?: string;
  configuration?: Record<string, any>;
  changeReason?: string;
}

export class CreateApprovalRequestDto {
  actionKey!: string;
  title!: string;
  description?: string;
  riskLevel?: string;
  actionPayload?: Record<string, any>;
  organizationId?: string;
}

export class ReviewApprovalRequestDto {
  reason?: string;
}

export class CreateGovernanceExceptionDto {
  policyKey!: string;
  scope!: string;
  reason!: string;
  expiresAt!: string;
}

export class ToggleEmergencyControlDto {
  enabled!: boolean;
  reason!: string;
}

export class ExecutePrivilegedActionDto {
  actionKey!: string;
  payload?: Record<string, any>;
  reason!: string;
  mfaToken?: string;
}

export class GovernanceFilterQueryDto {
  category?: string;
  status?: string;
  enforcementMode?: string;
  riskLevel?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

