import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export const GovernanceCategory = {
  ACCESS: 'ACCESS',
  TENANT_ISOLATION: 'TENANT_ISOLATION',
  FINANCIAL: 'FINANCIAL',
  DATA_PROTECTION: 'DATA_PROTECTION',
  API_GOVERNANCE: 'API_GOVERNANCE',
  INTEGRATIONS: 'INTEGRATIONS',
  OPERATIONS: 'OPERATIONS',
} as const;
export type GovernanceCategory = (typeof GovernanceCategory)[keyof typeof GovernanceCategory];

export const GovernancePolicyStatus = {
  DRAFT: 'DRAFT',
  REVIEW: 'REVIEW',
  APPROVED: 'APPROVED',
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type GovernancePolicyStatus = (typeof GovernancePolicyStatus)[keyof typeof GovernancePolicyStatus];

export const GovernanceEnforcementMode = {
  MONITOR: 'MONITOR',
  WARN: 'WARN',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  BLOCK: 'BLOCK',
} as const;
export type GovernanceEnforcementMode = (typeof GovernanceEnforcementMode)[keyof typeof GovernanceEnforcementMode];

export const GovernanceRiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type GovernanceRiskLevel = (typeof GovernanceRiskLevel)[keyof typeof GovernanceRiskLevel];

export const GovernanceApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type GovernanceApprovalStatus = (typeof GovernanceApprovalStatus)[keyof typeof GovernanceApprovalStatus];

export const GovernanceExceptionStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type GovernanceExceptionStatus = (typeof GovernanceExceptionStatus)[keyof typeof GovernanceExceptionStatus];

@Entity('governance_policies')
export class GovernancePolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  key!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: GovernanceCategory.OPERATIONS })
  category!: string;

  @Column({ type: 'varchar', length: 50, default: 'GLOBAL' })
  scope!: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: GovernancePolicyStatus.ACTIVE })
  status!: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: GovernanceEnforcementMode.BLOCK })
  enforcementMode!: string;

  @Column({ type: 'varchar', length: 50, default: GovernanceRiskLevel.HIGH })
  riskLevel!: string;

  @Column({ type: 'int', default: 1 })
  currentVersion!: number;

  @Column({ type: 'simple-json', nullable: true })
  configuration!: Record<string, any>;

  @Column({ type: 'timestamp', nullable: true })
  effectiveAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updatedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('governance_policy_versions')
export class GovernancePolicyVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  policyId!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  policyKey!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'simple-json', nullable: true })
  configurationSnapshot!: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  changeReason?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  authorId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  authorEmail?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reviewerId?: string;

  @Column({ type: 'varchar', length: 50, default: 'APPROVED' })
  approvalState!: string;

  @Column({ type: 'simple-json', nullable: true })
  diff?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('governance_approval_policies')
export class GovernanceApprovalPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  actionKey!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'int', default: 1 })
  requiredApprovals!: number;

  @Column({ type: 'varchar', length: 50, default: 'SUPER_ADMIN' })
  requiredRole!: string;

  @Column({ type: 'varchar', length: 50, default: 'PRIVILEGED_ADMIN' })
  minimumPrivilege!: string;

  @Column({ type: 'int', default: 24 })
  expirationHours!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('governance_approval_requests')
export class GovernanceApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  actionKey!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 50, default: GovernanceRiskLevel.HIGH })
  riskLevel!: string;

  @Column({ type: 'varchar', length: 255 })
  requestedBy!: string;

  @Column({ type: 'varchar', length: 255 })
  requestedByEmail!: string;

  @Column({ type: 'timestamp' })
  requestedAt!: Date;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Index()
  @Column({ type: 'varchar', length: 50, default: GovernanceApprovalStatus.PENDING })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  approverId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  approverEmail?: string;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ type: 'simple-json', nullable: true })
  actionPayload?: Record<string, any>;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('governance_exceptions')
export class GovernanceException {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  policyKey!: string;

  @Column({ type: 'varchar', length: 255 })
  scope!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'varchar', length: 255 })
  requestedBy!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  approvedBy?: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Index()
  @Column({ type: 'varchar', length: 50, default: GovernanceExceptionStatus.ACTIVE })
  status!: string;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  revokedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('governance_emergency_controls')
export class GovernanceEmergencyControl {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  controlKey!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  activatedBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  activatedByEmail?: string;

  @Column({ type: 'timestamp', nullable: true })
  activatedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('governance_violations')
export class GovernanceViolation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  policyKey!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actionKey?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail?: string;

  @Column({ type: 'varchar', length: 50, default: GovernanceRiskLevel.HIGH })
  riskLevel!: string;

  @Column({ type: 'varchar', length: 100 })
  violationType!: string;

  @Column({ type: 'simple-json', nullable: true })
  details?: Record<string, any>;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ipAddress?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
