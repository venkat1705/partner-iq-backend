import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export const FlagValueType = {
  BOOLEAN: 'BOOLEAN',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  JSON: 'JSON',
} as const;
export type FlagValueType = (typeof FlagValueType)[keyof typeof FlagValueType];

export const FlagLifecycleStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ROLLED_OUT: 'ROLLED_OUT',
  PAUSED: 'PAUSED',
  DISABLED: 'DISABLED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type FlagLifecycleStatus = (typeof FlagLifecycleStatus)[keyof typeof FlagLifecycleStatus];

export const FlagFailureBehavior = {
  FAIL_CLOSED: 'FAIL_CLOSED',
  FAIL_OPEN: 'FAIL_OPEN',
} as const;
export type FlagFailureBehavior = (typeof FlagFailureBehavior)[keyof typeof FlagFailureBehavior];

export const FlagCategory = {
  RELEASE: 'RELEASE',
  EXPERIMENT: 'EXPERIMENT',
  OPERATIONAL: 'OPERATIONAL',
  KILL_SWITCH: 'KILL_SWITCH',
  PERMISSION_ADJACENT: 'PERMISSION_ADJACENT',
} as const;
export type FlagCategory = (typeof FlagCategory)[keyof typeof FlagCategory];

export const EnvironmentName = {
  DEVELOPMENT: 'DEVELOPMENT',
  STAGING: 'STAGING',
  PRODUCTION: 'PRODUCTION',
} as const;
export type EnvironmentName = (typeof EnvironmentName)[keyof typeof EnvironmentName];

export const OverrideSubjectType = {
  ORGANIZATION: 'ORGANIZATION',
  USER: 'USER',
  AFFILIATE: 'AFFILIATE',
} as const;
export type OverrideSubjectType = (typeof OverrideSubjectType)[keyof typeof OverrideSubjectType];

@Entity('feature_flags')
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  key!: string; // e.g. affiliate.analytics.v2

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 30, default: 'BOOLEAN' })
  type!: FlagValueType;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: FlagLifecycleStatus;

  @Column({ type: 'text', nullable: true })
  defaultValue?: string; // Serialized string or JSON

  @Column({ type: 'varchar', length: 30, default: 'FAIL_CLOSED' })
  failureBehavior!: FlagFailureBehavior;

  @Column({ type: 'varchar', length: 60, default: 'RELEASE' })
  category!: FlagCategory;

  @Column({ type: 'varchar', length: 120, default: 'Platform Engineering' })
  ownerTeam!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  ownerUserId?: string;

  @Column({ type: 'boolean', default: false })
  isPermanent!: boolean;

  @Column({ type: 'varchar', length: 60, nullable: true })
  expiresAt?: string;

  @Column({ type: 'int', default: 1 })
  version!: number; // Optimistic locking and snapshot pointer

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'varchar', length: 120, default: 'system' })
  createdBy!: string;

  @Column({ type: 'varchar', length: 120, default: 'system' })
  updatedBy!: string;
}

@Entity('feature_flag_environments')
@Unique(['featureFlagId', 'environment'])
export class FeatureFlagEnvironment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  featureFlagId!: string;

  @Column({ type: 'varchar', length: 30 })
  environment!: EnvironmentName;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'int', default: 0 })
  rolloutPercentage!: number; // 0 to 100

  @Column({ type: 'varchar', length: 30, default: 'ORGANIZATION' })
  rolloutAttribute!: OverrideSubjectType;

  @Column({ type: 'varchar', length: 30, default: 'FAIL_CLOSED' })
  failureBehavior!: FlagFailureBehavior;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'varchar', length: 120, default: 'system' })
  updatedBy!: string;
}

export interface RuleCondition {
  attribute: 'plan' | 'role' | 'country' | 'organizationId' | 'userId' | 'affiliateId';
  operator: 'EQUALS' | 'NOT_EQUALS' | 'IN' | 'NOT_IN' | 'CONTAINS';
  value: any;
}

@Entity('feature_flag_rules')
export class FeatureFlagRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  featureFlagEnvironmentId!: string;

  @Column({ type: 'int', default: 1 })
  priority!: number; // 1 = highest

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'simple-json' })
  conditions!: RuleCondition[];

  @Column({ type: 'text', nullable: true })
  value?: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'varchar', length: 120, default: 'system' })
  createdBy!: string;
}

@Entity('feature_flag_overrides')
@Unique(['featureFlagEnvironmentId', 'subjectType', 'subjectId'])
export class FeatureFlagOverride {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  featureFlagEnvironmentId!: string;

  @Column({ type: 'varchar', length: 30 })
  subjectType!: OverrideSubjectType;

  @Column({ type: 'varchar', length: 120 })
  subjectId!: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  subjectLabel!: string; // e.g. Acme Corp, user@example.com

  @Column({ type: 'text', nullable: true })
  value?: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  expiresAt?: string; // ISO date string

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'varchar', length: 120, default: 'system' })
  createdBy!: string;
}

export const FlagVersionChangeType = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  ROLLOUT_CHANGED: 'ROLLOUT_CHANGED',
  RULE_MUTATED: 'RULE_MUTATED',
  OVERRIDE_CHANGED: 'OVERRIDE_CHANGED',
  KILL_SWITCH: 'KILL_SWITCH',
  ROLLED_BACK: 'ROLLED_BACK',
} as const;
export type FlagVersionChangeType = (typeof FlagVersionChangeType)[keyof typeof FlagVersionChangeType];

@Entity('feature_flag_versions')
export class FeatureFlagVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  featureFlagId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'simple-json' })
  snapshot!: any; // Complete state of flag, envs, rules, and overrides

  @Column({ type: 'varchar', length: 60, default: 'UPDATED' })
  changeType!: FlagVersionChangeType;

  @Column({ type: 'text', nullable: true })
  changeReason?: string;

  @Column({ type: 'varchar', length: 120, default: 'system' })
  changedBy!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

export const DependencyRelationship = {
  REQUIRES_ENABLED: 'REQUIRES_ENABLED',
  REQUIRES_DISABLED: 'REQUIRES_DISABLED',
} as const;
export type DependencyRelationship = (typeof DependencyRelationship)[keyof typeof DependencyRelationship];

@Entity('feature_flag_dependencies')
export class FeatureFlagDependency {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  sourceFlagKey!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  targetFlagKey!: string;

  @Column({ type: 'varchar', length: 60, default: 'REQUIRES_ENABLED' })
  relationship!: DependencyRelationship;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('feature_flag_metrics')
export class FeatureFlagEvaluationMetric {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  flagKey!: string;

  @Column({ type: 'varchar', length: 30 })
  environment!: EnvironmentName;

  @Column({ type: 'int', default: 0 })
  totalEvaluations!: number;

  @Column({ type: 'int', default: 0 })
  enabledCount!: number;

  @Column({ type: 'int', default: 0 })
  disabledCount!: number;

  @Column({ type: 'int', default: 0 })
  defaultedCount!: number;

  @Column({ type: 'int', default: 0 })
  overrideCount!: number;

  @Column({ type: 'int', default: 0 })
  ruleMatchCount!: number;

  @Column({ type: 'int', default: 0 })
  errorCount!: number;

  @CreateDateColumn()
  lastEvaluatedAt!: Date;
}

@Entity('feature_flag_settings')
export class FeatureFlagSettingsRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', default: 60 })
  evaluationCacheTtlSeconds!: number;

  @Column({ type: 'varchar', length: 30, default: 'FAIL_CLOSED' })
  defaultFailurePolicy!: FlagFailureBehavior;

  @Column({ type: 'int', default: 100 })
  telemetrySamplingRatePct!: number;

  @Column({ type: 'boolean', default: true })
  enableAuditLogging!: boolean;

  @Column({ type: 'boolean', default: true })
  enforceNamingConventions!: boolean;

  @Column({ type: 'varchar', length: 255, default: '^[a-z0-9]+(\\.[a-z0-9-]+)+$' })
  namingPatternRegex!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}

