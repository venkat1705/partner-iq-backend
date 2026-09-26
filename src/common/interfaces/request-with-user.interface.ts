import { Request } from 'express';
import { EnvironmentType, PlatformRole, Role } from '../enums';
import { ProgramAccessType } from '../enums/rbac';

export interface PartnerIqRequestContext {
  userId?: string;
  email?: string;
  organizationId: string;
  programId?: string;
  environment: EnvironmentType;
  apiKeyId?: string;
  isApiKey: boolean;
  role?: Role;
  roles?: string[];
  permissions?: string[];
  programAccessType?: ProgramAccessType;
  programIds?: string[];
  scopes?: string[];
}

export interface AuthUserPayload {
  userId: string;
  email: string;
  sessionId?: string;
  platformRole?: PlatformRole;
  isSuperAdmin?: boolean;
  organizationId?: string;
  environment?: EnvironmentType;
  affiliateId?: string;
  role?: Role;
  programAccessType?: ProgramAccessType;
  programIds?: string[];
  apiKeyId?: string;
  apiKeyEnvironment?: 'test' | 'live' | EnvironmentType;
  scopes?: string[];
  isApiKey?: boolean;
  mustChangePassword?: boolean;
}

export interface RequestWithUser extends Request {
  user?: AuthUserPayload;
  partnerIqContext?: PartnerIqRequestContext;
  tenantId?: string;
  environment?: EnvironmentType;
  idempotencyKey?: string;
}

