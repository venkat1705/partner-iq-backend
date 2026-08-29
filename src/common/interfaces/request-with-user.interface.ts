import { Request } from 'express';
import { PlatformRole, Role } from '../enums';
import { ProgramAccessType } from '../enums/rbac';

export interface AuthUserPayload {
  userId: string;
  email: string;
  sessionId?: string;
  platformRole?: PlatformRole;
  isSuperAdmin?: boolean;
  organizationId?: string;
  affiliateId?: string;
  role?: Role;
  programAccessType?: ProgramAccessType;
  programIds?: string[];
  apiKeyId?: string;
  apiKeyEnvironment?: 'test' | 'live';
  scopes?: string[];
  isApiKey?: boolean;
}

export interface RequestWithUser extends Request {
  user?: AuthUserPayload;
  tenantId?: string;
  idempotencyKey?: string;
}
