import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, awaitPersist } from '../../../database/store';
import {
  FeatureFlag,
  FeatureFlagEnvironment,
  FeatureFlagRule,
  FeatureFlagOverride,
  FeatureFlagVersion,
  FeatureFlagDependency,
  FeatureFlagEvaluationMetric,
  FeatureFlagSettingsRecord,
  FlagLifecycleStatus,
  FlagValueType,
  FlagCategory,
  EnvironmentName,
  OverrideSubjectType,
  FlagFailureBehavior,
  RuleCondition,
} from '../../../database/schema-feature-flags';

export class FlagsFilterQuery {
  search?: string;
  environment?: EnvironmentName;
  status?: FlagLifecycleStatus;
  category?: FlagCategory;
  type?: FlagValueType;
  ownerTeam?: string;
  limit?: number = 25;
  offset?: number = 0;
}

export class EvaluationContext {
  environment?: EnvironmentName;
  organizationId?: string;
  userId?: string;
  affiliateId?: string;
  role?: string;
  plan?: string;
  country?: string;
}

export interface EvaluationResult {
  enabled: boolean;
  value: any;
  flagKey: string;
  environment: EnvironmentName;
  source:
  | 'KILL_SWITCH'
  | 'ENVIRONMENT_DISABLED'
  | 'OVERRIDE'
  | 'RULE_MATCH'
  | 'PERCENTAGE_ROLLOUT'
  | 'ENVIRONMENT_DEFAULT'
  | 'FLAG_DEFAULT'
  | 'FALLBACK_ERROR';
  matchedRuleId?: string;
  matchedRuleName?: string;
  matchedOverrideId?: string;
  subjectBucket?: number;
  rolloutPercentage?: number;
  version: number;
  evaluationSteps: string[];
}

export class CreateFlagDto {
  key!: string;
  name!: string;
  description?: string;
  type?: FlagValueType;
  category?: FlagCategory;
  ownerTeam?: string;
  isPermanent?: boolean;
  expiresAt?: string;
  defaultValue?: string;
  failureBehavior?: FlagFailureBehavior;
  initialEnvironments?: {
    environment: EnvironmentName;
    enabled: boolean;
    rolloutPercentage?: number;
  }[];
}

export class UpdateFlagDto {
  name?: string;
  description?: string;
  category?: FlagCategory;
  ownerTeam?: string;
  isPermanent?: boolean;
  expiresAt?: string;
  defaultValue?: string;
  failureBehavior?: FlagFailureBehavior;
  status?: FlagLifecycleStatus;
  expectedVersion?: number;
  reason?: string;
}

export class UpdateEnvironmentDto {
  enabled?: boolean;
  rolloutPercentage?: number;
  rolloutAttribute?: OverrideSubjectType;
  failureBehavior?: FlagFailureBehavior;
  reason?: string;
}

export class SetRuleDto {
  id?: string;
  priority!: number;
  name!: string;
  conditions!: RuleCondition[];
  value!: string;
  enabled?: boolean;
  reason?: string;
}

export class SetOverrideDto {
  id?: string;
  subjectType!: OverrideSubjectType;
  subjectId!: string;
  subjectLabel?: string;
  value!: string;
  reason?: string;
  expiresAt?: string;
}

@Injectable()
export class FeatureFlagsService {
  private cache: Map<string, { value: EvaluationResult; expiresAt: number }> = new Map();

  constructor() {
    // Auto-seeding a fabricated set of "sample" flags (invented feature
    // names, made-up rollout percentages, descriptions of capabilities that
    // don't gate any real code path) on every instantiation was placeholder
    // demo data, not real platform configuration — removed. The flag
    // registry now starts empty; flags are created for real via
    // createFlag(). `seedDefaultFlagsIfEmpty()` is kept only as an explicit,
    // manually-invoked helper for local/dev bootstrapping.
  }

  // --------------------------------------------------------------------------
  // DETERMINISTIC HASH BUCKETING
  // --------------------------------------------------------------------------
  public getBucketValue(flagKey: string, subjectId: string): number {
    let hash = 0;
    const str = `${flagKey}:${subjectId}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash) % 100;
  }

  // --------------------------------------------------------------------------
  // EVALUATION ENGINE
  // --------------------------------------------------------------------------
  public evaluate(flagKey: string, context: EvaluationContext = {}): EvaluationResult {
    const environment: EnvironmentName = context.environment || 'PRODUCTION';
    const steps: string[] = [];

    // Find Flag
    const flag = dbStore.featureFlags.find((f) => f.key === flagKey);
    if (!flag) {
      steps.push(`Flag with key '${flagKey}' not found in registry. Falling back to default.`);
      return {
        enabled: false,
        value: false,
        flagKey,
        environment,
        source: 'FALLBACK_ERROR',
        version: 0,
        evaluationSteps: steps,
      };
    }

    steps.push(`Evaluated flag '${flag.name}' (${flag.key}) at version ${flag.version}.`);

    // 1. Status & Kill-Switch Check
    if (flag.status === 'DISABLED' || flag.status === 'ARCHIVED') {
      steps.push(`Flag status is ${flag.status}. Emergency cutoff applied.`);
      this.recordMetric(flagKey, environment, false, 'KILL_SWITCH');
      return {
        enabled: false,
        value: this.parseValue(flag.defaultValue, flag.type),
        flagKey,
        environment,
        source: 'KILL_SWITCH',
        version: flag.version,
        evaluationSteps: steps,
      };
    }

    // 2. Environment Isolation Check
    const envConfig = dbStore.featureFlagEnvironments.find(
      (e) => e.featureFlagId === flag.id && e.environment === environment
    );

    if (!envConfig || !envConfig.enabled) {
      steps.push(`Environment '${environment}' is currently disabled for this flag.`);
      this.recordMetric(flagKey, environment, false, 'ENVIRONMENT_DISABLED');
      return {
        enabled: false,
        value: this.parseValue(flag.defaultValue, flag.type),
        flagKey,
        environment,
        source: 'ENVIRONMENT_DISABLED',
        version: flag.version,
        evaluationSteps: steps,
      };
    }

    steps.push(`Environment '${environment}' is active.`);

    // 3. Tenant Overrides Check (User -> Affiliate -> Organization)
    const overrides = dbStore.featureFlagOverrides.filter(
      (o) => o.featureFlagEnvironmentId === envConfig.id
    );

    const now = Date.now();
    const activeOverrides = overrides.filter((o) => {
      if (!o.expiresAt) return true;
      return new Date(o.expiresAt).getTime() > now;
    });

    let matchedOverride: FeatureFlagOverride | undefined;

    if (context.userId) {
      matchedOverride = activeOverrides.find(
        (o) => o.subjectType === 'USER' && o.subjectId === context.userId
      );
    }
    if (!matchedOverride && context.affiliateId) {
      matchedOverride = activeOverrides.find(
        (o) => o.subjectType === 'AFFILIATE' && o.subjectId === context.affiliateId
      );
    }
    if (!matchedOverride && context.organizationId) {
      matchedOverride = activeOverrides.find(
        (o) => o.subjectType === 'ORGANIZATION' && o.subjectId === context.organizationId
      );
    }

    if (matchedOverride) {
      const parsedVal = this.parseValue(matchedOverride.value, flag.type);
      const isEnabled = Boolean(parsedVal);
      steps.push(
        `Matched ${matchedOverride.subjectType} override for '${matchedOverride.subjectLabel || matchedOverride.subjectId}' -> ${matchedOverride.value}`
      );
      this.recordMetric(flagKey, environment, isEnabled, 'OVERRIDE');
      return {
        enabled: isEnabled,
        value: parsedVal,
        flagKey,
        environment,
        source: 'OVERRIDE',
        matchedOverrideId: matchedOverride.id,
        version: flag.version,
        evaluationSteps: steps,
      };
    }

    // 4. Priority Targeting Rules Check
    const rules = dbStore.featureFlagRules
      .filter((r) => r.featureFlagEnvironmentId === envConfig.id && r.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of rules) {
      const matches = this.evaluateRuleConditions(rule.conditions, context);
      if (matches) {
        const parsedVal = this.parseValue(rule.value, flag.type);
        const isEnabled = Boolean(parsedVal);
        steps.push(`Rule matched: '${rule.name}' (Priority ${rule.priority}) -> ${rule.value}`);
        this.recordMetric(flagKey, environment, isEnabled, 'RULE_MATCH');
        return {
          enabled: isEnabled,
          value: parsedVal,
          flagKey,
          environment,
          source: 'RULE_MATCH',
          matchedRuleId: rule.id,
          matchedRuleName: rule.name,
          version: flag.version,
          evaluationSteps: steps,
        };
      }
    }

    // 5. Deterministic Percentage Rollout
    const rolloutPct = envConfig.rolloutPercentage ?? 100;
    const subjectId = context.organizationId || context.userId || context.affiliateId || 'anonymous';
    const bucket = this.getBucketValue(flagKey, subjectId);

    steps.push(
      `Percentage rollout configured at ${rolloutPct}%. Subject '${subjectId}' assigned to bucket ${bucket}.`
    );

    if (rolloutPct >= 100) {
      steps.push(`Rollout is 100% enabled for all subjects in environment.`);
      this.recordMetric(flagKey, environment, true, 'PERCENTAGE_ROLLOUT');
      return {
        enabled: true,
        value: this.parseValue(flag.defaultValue === 'false' ? 'true' : flag.defaultValue, flag.type),
        flagKey,
        environment,
        source: 'PERCENTAGE_ROLLOUT',
        subjectBucket: bucket,
        rolloutPercentage: rolloutPct,
        version: flag.version,
        evaluationSteps: steps,
      };
    }

    if (rolloutPct > 0 && bucket < rolloutPct) {
      steps.push(`Bucket ${bucket} is within rollout threshold (< ${rolloutPct}%). Result: ENABLED.`);
      this.recordMetric(flagKey, environment, true, 'PERCENTAGE_ROLLOUT');
      return {
        enabled: true,
        value: this.parseValue(flag.defaultValue === 'false' ? 'true' : flag.defaultValue, flag.type),
        flagKey,
        environment,
        source: 'PERCENTAGE_ROLLOUT',
        subjectBucket: bucket,
        rolloutPercentage: rolloutPct,
        version: flag.version,
        evaluationSteps: steps,
      };
    }

    if (rolloutPct > 0 && bucket >= rolloutPct) {
      steps.push(`Bucket ${bucket} exceeds rollout threshold (>= ${rolloutPct}%). Result: DISABLED.`);
      this.recordMetric(flagKey, environment, false, 'PERCENTAGE_ROLLOUT');
      return {
        enabled: false,
        value: this.parseValue(flag.defaultValue, flag.type),
        flagKey,
        environment,
        source: 'PERCENTAGE_ROLLOUT',
        subjectBucket: bucket,
        rolloutPercentage: rolloutPct,
        version: flag.version,
        evaluationSteps: steps,
      };
    }

    // 6. Environment Default Fallback
    steps.push(`No overrides or rules matched. Using environment default value.`);
    this.recordMetric(flagKey, environment, envConfig.enabled, 'ENVIRONMENT_DEFAULT');
    return {
      enabled: envConfig.enabled,
      value: this.parseValue(flag.defaultValue, flag.type),
      flagKey,
      environment,
      source: 'ENVIRONMENT_DEFAULT',
      version: flag.version,
      evaluationSteps: steps,
    };
  }

  public evaluateMany(
    flagKeys: string[],
    context: EvaluationContext = {}
  ): Record<string, EvaluationResult> {
    const results: Record<string, EvaluationResult> = {};
    for (const key of flagKeys) {
      results[key] = this.evaluate(key, context);
    }
    return results;
  }

  // --------------------------------------------------------------------------
  // ADMIN OVERVIEW & KPIS
  // --------------------------------------------------------------------------
  public getOverview(environment: EnvironmentName = 'PRODUCTION') {
    const flags = dbStore.featureFlags;
    const envConfigs = dbStore.featureFlagEnvironments.filter((e) => e.environment === environment);

    const totalFlags = flags.length;
    const activeInProd = envConfigs.filter((e) => e.enabled && e.rolloutPercentage === 100).length;
    const partialRollouts = envConfigs.filter((e) => e.enabled && e.rolloutPercentage > 0 && e.rolloutPercentage < 100).length;
    const totalOverrides = dbStore.featureFlagOverrides.length;

    // Check expiring and stale flags
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const expiringCount = flags.filter((f) => {
      if (!f.expiresAt) return false;
      return new Date(f.expiresAt).getTime() > now && new Date(f.expiresAt).getTime() < now + 14 * 24 * 60 * 60 * 1000;
    }).length;

    const staleCount = flags.filter((f) => {
      if (f.isPermanent) return false;
      const is100InProd = envConfigs.some((e) => e.featureFlagId === f.id && e.enabled && e.rolloutPercentage === 100);
      const isOld = new Date(f.updatedAt).getTime() < thirtyDaysAgo;
      return is100InProd && isOld;
    }).length;

    // Metrics rollups
    const totalEvals = dbStore.featureFlagMetrics
      .filter((m) => m.environment === environment)
      .reduce((acc, m) => acc + m.totalEvaluations, 0);

    const recentVersions = [...dbStore.featureFlagVersions]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);

    return {
      kpi: {
        totalFlags,
        activeInProd,
        partialRollouts,
        totalOverrides,
        expiringCount,
        staleCount,
        totalEvaluations24h: totalEvals,
        evaluationErrorRatePct: 0,
      },
      environmentDistribution: {
        DEVELOPMENT: dbStore.featureFlagEnvironments.filter((e) => e.environment === 'DEVELOPMENT' && e.enabled).length,
        STAGING: dbStore.featureFlagEnvironments.filter((e) => e.environment === 'STAGING' && e.enabled).length,
        PRODUCTION: dbStore.featureFlagEnvironments.filter((e) => e.environment === 'PRODUCTION' && e.enabled).length,
      },
      recentVersions,
      activeRollouts: envConfigs
        .filter((e) => e.enabled && e.rolloutPercentage > 0)
        .map((e) => {
          const flag = flags.find((f) => f.id === e.featureFlagId);
          return {
            id: e.id,
            flagId: e.featureFlagId,
            flagKey: flag?.key || 'unknown',
            flagName: flag?.name || 'Unknown',
            rolloutPercentage: e.rolloutPercentage,
            attribute: e.rolloutAttribute,
            updatedAt: e.updatedAt,
          };
        }),
    };
  }

  // --------------------------------------------------------------------------
  // FLAGS CRUD & MANAGEMENT
  // --------------------------------------------------------------------------
  public listFlags(query: FlagsFilterQuery = {}) {
    let result = [...dbStore.featureFlags];

    if (query.search) {
      const s = query.search.toLowerCase();
      result = result.filter(
        (f) =>
          f.key.toLowerCase().includes(s) ||
          f.name.toLowerCase().includes(s) ||
          f.description.toLowerCase().includes(s) ||
          f.ownerTeam.toLowerCase().includes(s)
      );
    }

    if (query.status) {
      result = result.filter((f) => f.status === query.status);
    }

    if (query.category) {
      result = result.filter((f) => f.category === query.category);
    }

    if (query.type) {
      result = result.filter((f) => f.type === query.type);
    }

    const total = result.length;
    const offset = query.offset || 0;
    const limit = query.limit || 25;
    const flagsPage = result.slice(offset, offset + limit);

    // Enrich with environment states and overrides count
    const enriched = flagsPage.map((f) => {
      const envs = dbStore.featureFlagEnvironments.filter((e) => e.featureFlagId === f.id);
      const prodEnv = envs.find((e) => e.environment === 'PRODUCTION');
      const overridesCount = dbStore.featureFlagOverrides.filter((o) =>
        envs.some((e) => e.id === o.featureFlagEnvironmentId)
      ).length;

      return {
        ...f,
        environments: envs,
        prodEnabled: prodEnv?.enabled ?? false,
        prodRolloutPct: prodEnv?.rolloutPercentage ?? 0,
        overridesCount,
      };
    });

    return {
      flags: enriched,
      total,
      limit,
      offset,
    };
  }

  public getFlagById(id: string) {
    const flag = dbStore.featureFlags.find((f) => f.id === id || f.key === id);
    if (!flag) {
      throw new NotFoundException(`Feature flag '${id}' not found`);
    }

    const environments = dbStore.featureFlagEnvironments.filter(
      (e) => e.featureFlagId === flag.id
    );

    const rules = dbStore.featureFlagRules.filter((r) =>
      environments.some((e) => e.id === r.featureFlagEnvironmentId)
    );

    const overrides = dbStore.featureFlagOverrides.filter((o) =>
      environments.some((e) => e.id === o.featureFlagEnvironmentId)
    );

    const versions = dbStore.featureFlagVersions
      .filter((v) => v.featureFlagId === flag.id)
      .sort((a, b) => b.version - a.version);

    const dependencies = dbStore.featureFlagDependencies.filter(
      (d) => d.sourceFlagKey === flag.key || d.targetFlagKey === flag.key
    );

    return {
      flag,
      environments,
      rules,
      overrides,
      versions,
      dependencies,
    };
  }

  // NOTE: used synchronously (unawaited) by src/tests/feature-flags.test.ts, a standalone
  // script outside this fix's scope directories. Converting to async would break that
  // caller's type-checking, so it is intentionally left synchronous without awaitPersist —
  // see handback report.
  public createFlag(dto: CreateFlagDto, actor: string = 'admin'): FeatureFlag {
    // Validate lowercase dot-separated key
    const key = dto.key.trim().toLowerCase();
    const keyRegex = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
    if (!keyRegex.test(key)) {
      throw new BadRequestException(
        `Invalid flag key '${key}'. Keys must be lowercase, alphanumeric, dot-separated (e.g. 'billing.enterprise-contracts').`
      );
    }

    if (dbStore.featureFlags.some((f) => f.key === key)) {
      throw new ConflictException(`Feature flag with key '${key}' already exists.`);
    }

    const flag = new FeatureFlag();
    flag.id = uuidv4();
    flag.key = key;
    flag.name = dto.name.trim();
    flag.description = dto.description || '';
    flag.type = dto.type || 'BOOLEAN';
    flag.status = 'ACTIVE';
    flag.defaultValue = dto.defaultValue || 'false';
    flag.failureBehavior = dto.failureBehavior || 'FAIL_CLOSED';
    flag.category = dto.category || 'RELEASE';
    flag.ownerTeam = dto.ownerTeam || 'Platform Engineering';
    flag.isPermanent = dto.isPermanent || false;
    flag.expiresAt = dto.expiresAt;
    flag.version = 1;
    flag.createdBy = actor;
    flag.updatedBy = actor;
    flag.createdAt = new Date();
    flag.updatedAt = new Date();

    dbStore.featureFlags.push(flag);

    // Create 3 isolated environments (Dev, Staging, Prod)
    const envNames: EnvironmentName[] = ['DEVELOPMENT', 'STAGING', 'PRODUCTION'];
    for (const env of envNames) {
      const envSetting = dto.initialEnvironments?.find((e) => e.environment === env);
      const fe = new FeatureFlagEnvironment();
      fe.id = uuidv4();
      fe.featureFlagId = flag.id;
      fe.environment = env;
      fe.enabled = envSetting ? envSetting.enabled : env === 'DEVELOPMENT';
      fe.rolloutPercentage = envSetting?.rolloutPercentage ?? (env === 'DEVELOPMENT' ? 100 : 0);
      fe.rolloutAttribute = 'ORGANIZATION';
      fe.failureBehavior = flag.failureBehavior;
      fe.version = 1;
      fe.updatedBy = actor;
      fe.createdAt = new Date();
      fe.updatedAt = new Date();
      dbStore.featureFlagEnvironments.push(fe);
    }

    this.snapshotVersion(flag.id, 'CREATED', 'Initial feature flag creation', actor);
    this.invalidateCache();
    return flag;
  }

  public async updateFlag(id: string, dto: UpdateFlagDto, actor: string = 'admin'): Promise<FeatureFlag> {
    const flag = dbStore.featureFlags.find((f) => f.id === id || f.key === id);
    if (!flag) {
      throw new NotFoundException(`Feature flag '${id}' not found`);
    }

    // Optimistic locking check
    if (dto.expectedVersion && dto.expectedVersion !== flag.version) {
      throw new ConflictException(
        `Configuration changed by another administrator (Current version: ${flag.version}, expected: ${dto.expectedVersion}). Refresh before saving.`
      );
    }

    if (dto.name) flag.name = dto.name.trim();
    if (dto.description !== undefined) flag.description = dto.description;
    if (dto.category) flag.category = dto.category;
    if (dto.ownerTeam) flag.ownerTeam = dto.ownerTeam;
    if (dto.isPermanent !== undefined) flag.isPermanent = dto.isPermanent;
    if (dto.expiresAt !== undefined) flag.expiresAt = dto.expiresAt;
    if (dto.defaultValue !== undefined) flag.defaultValue = dto.defaultValue;
    if (dto.failureBehavior) flag.failureBehavior = dto.failureBehavior;
    if (dto.status) flag.status = dto.status;

    flag.version += 1;
    flag.updatedBy = actor;
    flag.updatedAt = new Date();
    await awaitPersist(flag);

    this.snapshotVersion(flag.id, 'UPDATED', dto.reason || 'Updated flag settings', actor);
    this.invalidateCache();
    return flag;
  }

  public async updateEnvironment(
    flagId: string,
    environment: EnvironmentName,
    dto: UpdateEnvironmentDto,
    actor: string = 'admin'
  ): Promise<FeatureFlagEnvironment> {
    const flag = dbStore.featureFlags.find((f) => f.id === flagId || f.key === flagId);
    if (!flag) throw new NotFoundException(`Flag '${flagId}' not found`);

    let envConfig = dbStore.featureFlagEnvironments.find(
      (e) => e.featureFlagId === flag.id && e.environment === environment
    );

    if (!envConfig) {
      envConfig = new FeatureFlagEnvironment();
      envConfig.id = uuidv4();
      envConfig.featureFlagId = flag.id;
      envConfig.environment = environment;
      envConfig.createdAt = new Date();
      dbStore.featureFlagEnvironments.push(envConfig);
    }

    if (dto.enabled !== undefined) envConfig.enabled = dto.enabled;
    if (dto.rolloutPercentage !== undefined) {
      if (dto.rolloutPercentage < 0 || dto.rolloutPercentage > 100) {
        throw new BadRequestException('Rollout percentage must be between 0 and 100.');
      }
      envConfig.rolloutPercentage = dto.rolloutPercentage;
    }
    if (dto.rolloutAttribute) envConfig.rolloutAttribute = dto.rolloutAttribute;
    if (dto.failureBehavior) envConfig.failureBehavior = dto.failureBehavior;

    envConfig.version += 1;
    envConfig.updatedBy = actor;
    envConfig.updatedAt = new Date();

    flag.version += 1;
    flag.updatedBy = actor;
    flag.updatedAt = new Date();
    await Promise.all([awaitPersist(envConfig), awaitPersist(flag)]);

    this.snapshotVersion(
      flag.id,
      'ROLLOUT_CHANGED',
      dto.reason || `Updated ${environment} configuration (Rollout: ${envConfig.rolloutPercentage}%, Enabled: ${envConfig.enabled})`,
      actor
    );

    this.invalidateCache();
    return envConfig;
  }

  public async setRule(
    flagId: string,
    environment: EnvironmentName,
    dto: SetRuleDto,
    actor: string = 'admin'
  ): Promise<FeatureFlagRule> {
    const flag = dbStore.featureFlags.find((f) => f.id === flagId || f.key === flagId);
    if (!flag) throw new NotFoundException(`Flag '${flagId}' not found`);

    const envConfig = dbStore.featureFlagEnvironments.find(
      (e) => e.featureFlagId === flag.id && e.environment === environment
    );
    if (!envConfig) throw new NotFoundException(`Environment '${environment}' not found`);

    let rule: FeatureFlagRule;
    if (dto.id) {
      const found = dbStore.featureFlagRules.find((r) => r.id === dto.id);
      if (!found) throw new NotFoundException(`Rule '${dto.id}' not found`);
      rule = found;
    } else {
      rule = new FeatureFlagRule();
      rule.id = uuidv4();
      rule.featureFlagEnvironmentId = envConfig.id;
      rule.createdAt = new Date();
      rule.createdBy = actor;
      dbStore.featureFlagRules.push(rule);
    }

    rule.priority = dto.priority;
    rule.name = dto.name;
    rule.conditions = dto.conditions;
    rule.value = dto.value;
    rule.enabled = dto.enabled !== undefined ? dto.enabled : true;
    rule.updatedAt = new Date();

    flag.version += 1;
    flag.updatedBy = actor;
    flag.updatedAt = new Date();
    await Promise.all([awaitPersist(rule), awaitPersist(flag)]);

    this.snapshotVersion(
      flag.id,
      'RULE_MUTATED',
      dto.reason || `Mutated rule '${rule.name}' for ${environment}`,
      actor
    );

    this.invalidateCache();
    return rule;
  }

  public async deleteRule(flagId: string, ruleId: string, actor: string = 'admin'): Promise<boolean> {
    const flag = dbStore.featureFlags.find((f) => f.id === flagId || f.key === flagId);
    if (!flag) throw new NotFoundException(`Flag '${flagId}' not found`);

    const idx = dbStore.featureFlagRules.findIndex((r) => r.id === ruleId);
    if (idx === -1) throw new NotFoundException(`Rule '${ruleId}' not found`);

    dbStore.featureFlagRules.splice(idx, 1);

    flag.version += 1;
    flag.updatedBy = actor;
    flag.updatedAt = new Date();
    await awaitPersist(flag);

    this.snapshotVersion(flag.id, 'RULE_MUTATED', `Deleted rule ${ruleId}`, actor);
    this.invalidateCache();
    return true;
  }

  // NOTE: setOverride is used synchronously (unawaited) by src/tests/feature-flags.test.ts,
  // a standalone script outside this fix's scope directories. Converting it to async would
  // break that caller's type-checking, so it is intentionally left synchronous without an
  // awaitPersist call — see handback report.
  public setOverride(
    flagId: string,
    environment: EnvironmentName,
    dto: SetOverrideDto,
    actor: string = 'admin'
  ): FeatureFlagOverride {
    const flag = dbStore.featureFlags.find((f) => f.id === flagId || f.key === flagId);
    if (!flag) throw new NotFoundException(`Flag '${flagId}' not found`);

    const envConfig = dbStore.featureFlagEnvironments.find(
      (e) => e.featureFlagId === flag.id && e.environment === environment
    );
    if (!envConfig) throw new NotFoundException(`Environment '${environment}' not found`);

    let override = dbStore.featureFlagOverrides.find(
      (o) =>
        o.featureFlagEnvironmentId === envConfig.id &&
        o.subjectType === dto.subjectType &&
        o.subjectId === dto.subjectId
    );

    if (!override) {
      override = new FeatureFlagOverride();
      override.id = uuidv4();
      override.featureFlagEnvironmentId = envConfig.id;
      override.subjectType = dto.subjectType;
      override.subjectId = dto.subjectId;
      override.createdBy = actor;
      override.createdAt = new Date();
      dbStore.featureFlagOverrides.push(override);
    }

    override.subjectLabel = dto.subjectLabel || override.subjectLabel || dto.subjectId;
    override.value = dto.value;
    override.reason = dto.reason || '';
    override.expiresAt = dto.expiresAt;
    override.updatedAt = new Date();

    flag.version += 1;
    flag.updatedBy = actor;
    flag.updatedAt = new Date();

    this.snapshotVersion(
      flag.id,
      'OVERRIDE_CHANGED',
      dto.reason || `Set ${dto.subjectType} override for '${override.subjectLabel}'`,
      actor
    );

    this.invalidateCache();
    return override;
  }

  public async removeOverride(overrideId: string, actor: string = 'admin'): Promise<boolean> {
    const idx = dbStore.featureFlagOverrides.findIndex((o) => o.id === overrideId);
    if (idx === -1) throw new NotFoundException(`Override '${overrideId}' not found`);

    const override = dbStore.featureFlagOverrides[idx];
    const env = dbStore.featureFlagEnvironments.find((e) => e.id === override.featureFlagEnvironmentId);
    dbStore.featureFlagOverrides.splice(idx, 1);

    if (env) {
      const flag = dbStore.featureFlags.find((f) => f.id === env.featureFlagId);
      if (flag) {
        flag.version += 1;
        flag.updatedBy = actor;
        flag.updatedAt = new Date();
        await awaitPersist(flag);
        this.snapshotVersion(
          flag.id,
          'OVERRIDE_CHANGED',
          `Removed override for ${override.subjectType}:${override.subjectId}`,
          actor
        );
      }
    }

    this.invalidateCache();
    return true;
  }

  // --------------------------------------------------------------------------
  // EMERGENCY KILL SWITCH
  // --------------------------------------------------------------------------
  // NOTE: used synchronously (unawaited) by src/tests/feature-flags.test.ts, a standalone
  // script outside this fix's scope directories. Converting to async would break that
  // caller's type-checking, so it is intentionally left synchronous without awaitPersist —
  // see handback report.
  public emergencyKillSwitch(flagId: string, reason: string, actor: string = 'admin'): FeatureFlag {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('A descriptive reason is mandatory to trigger an emergency kill switch.');
    }

    const flag = dbStore.featureFlags.find((f) => f.id === flagId || f.key === flagId);
    if (!flag) throw new NotFoundException(`Flag '${flagId}' not found`);

    flag.status = 'DISABLED';
    flag.version += 1;
    flag.updatedBy = actor;
    flag.updatedAt = new Date();

    // Disable in all environments
    const envs = dbStore.featureFlagEnvironments.filter((e) => e.featureFlagId === flag.id);
    for (const e of envs) {
      e.enabled = false;
      e.updatedBy = actor;
      e.updatedAt = new Date();
    }

    this.snapshotVersion(flag.id, 'KILL_SWITCH', `EMERGENCY KILL SWITCH: ${reason}`, actor);
    this.invalidateCache();
    return flag;
  }

  // --------------------------------------------------------------------------
  // ROLLBACK ENGINE
  // --------------------------------------------------------------------------
  // NOTE: used synchronously (unawaited) by src/tests/feature-flags.test.ts, a standalone
  // script outside this fix's scope directories. Converting to async would break that
  // caller's type-checking, so it is intentionally left synchronous without awaitPersist —
  // see handback report.
  public rollbackToVersion(
    flagId: string,
    targetVersion: number,
    reason: string,
    actor: string = 'admin'
  ): FeatureFlag {
    const flag = dbStore.featureFlags.find((f) => f.id === flagId || f.key === flagId);
    if (!flag) throw new NotFoundException(`Flag '${flagId}' not found`);

    const versionRecord = dbStore.featureFlagVersions.find(
      (v) => v.featureFlagId === flag.id && v.version === targetVersion
    );

    if (!versionRecord || !versionRecord.snapshot) {
      throw new NotFoundException(`Snapshot for version ${targetVersion} not found.`);
    }

    const snap = versionRecord.snapshot;

    // Apply snapshot to flag
    flag.name = snap.flag.name;
    flag.description = snap.flag.description;
    flag.status = snap.flag.status;
    flag.defaultValue = snap.flag.defaultValue;
    flag.category = snap.flag.category;
    flag.version += 1; // Creates new version, preserves history!
    flag.updatedBy = actor;
    flag.updatedAt = new Date();

    // Restore environments
    if (snap.environments) {
      for (const eSnap of snap.environments) {
        let envConfig = dbStore.featureFlagEnvironments.find(
          (e) => e.featureFlagId === flag.id && e.environment === eSnap.environment
        );
        if (envConfig) {
          envConfig.enabled = eSnap.enabled;
          envConfig.rolloutPercentage = eSnap.rolloutPercentage;
          envConfig.rolloutAttribute = eSnap.rolloutAttribute;
          envConfig.failureBehavior = eSnap.failureBehavior;
          envConfig.updatedBy = actor;
          envConfig.updatedAt = new Date();
        }
      }
    }

    this.snapshotVersion(
      flag.id,
      'ROLLED_BACK',
      `Rolled back from Version ${flag.version - 1} to Version ${targetVersion}. Reason: ${reason || 'Rollback'}`,
      actor
    );

    this.invalidateCache();
    return flag;
  }

  // --------------------------------------------------------------------------
  // DEPENDENCIES & EXPIRING FLAGS
  // --------------------------------------------------------------------------
  public async addDependency(
    sourceFlagKey: string,
    targetFlagKey: string,
    relationship: 'REQUIRES_ENABLED' | 'REQUIRES_DISABLED' = 'REQUIRES_ENABLED'
  ): Promise<FeatureFlagDependency> {
    if (sourceFlagKey === targetFlagKey) {
      throw new BadRequestException('A flag cannot depend on itself.');
    }

    const dep = new FeatureFlagDependency();
    dep.id = uuidv4();
    dep.sourceFlagKey = sourceFlagKey;
    dep.targetFlagKey = targetFlagKey;
    dep.relationship = relationship;
    dep.createdAt = new Date();
    dbStore.featureFlagDependencies.push(dep);
    await awaitPersist(dep);
    return dep;
  }

  public getExpiringAndStaleFlags() {
    const now = Date.now();
    const flags = dbStore.featureFlags;

    const expiring = flags
      .filter((f) => f.expiresAt && new Date(f.expiresAt).getTime() > now)
      .map((f) => {
        const daysLeft = Math.ceil((new Date(f.expiresAt!).getTime() - now) / (1000 * 60 * 60 * 24));
        return {
          flag: f,
          daysLeft,
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const stale = flags.filter((f) => {
      if (f.isPermanent) return false;
      const is100InProd = dbStore.featureFlagEnvironments.some(
        (e) => e.featureFlagId === f.id && e.environment === 'PRODUCTION' && e.enabled && e.rolloutPercentage === 100
      );
      const isOld = new Date(f.updatedAt).getTime() < thirtyDaysAgo;
      return is100InProd && isOld;
    });

    return {
      expiring,
      stale,
    };
  }

  // --------------------------------------------------------------------------
  // SETTINGS
  // --------------------------------------------------------------------------
  public getSettings(): FeatureFlagSettingsRecord {
    let settings = dbStore.featureFlagSettingsRecords[0];
    if (!settings) {
      settings = new FeatureFlagSettingsRecord();
      settings.id = uuidv4();
      settings.evaluationCacheTtlSeconds = 60;
      settings.defaultFailurePolicy = 'FAIL_CLOSED';
      settings.telemetrySamplingRatePct = 100;
      settings.enableAuditLogging = true;
      settings.enforceNamingConventions = true;
      settings.namingPatternRegex = '^[a-z0-9]+(\\.[a-z0-9-]+)+$';
      settings.updatedAt = new Date();
      dbStore.featureFlagSettingsRecords.push(settings);
    }
    return settings;
  }

  public async updateSettings(updates: Partial<FeatureFlagSettingsRecord>): Promise<FeatureFlagSettingsRecord> {
    const settings = this.getSettings();
    if (updates.evaluationCacheTtlSeconds !== undefined) settings.evaluationCacheTtlSeconds = updates.evaluationCacheTtlSeconds;
    if (updates.defaultFailurePolicy !== undefined) settings.defaultFailurePolicy = updates.defaultFailurePolicy;
    if (updates.telemetrySamplingRatePct !== undefined) settings.telemetrySamplingRatePct = updates.telemetrySamplingRatePct;
    if (updates.enableAuditLogging !== undefined) settings.enableAuditLogging = updates.enableAuditLogging;
    if (updates.enforceNamingConventions !== undefined) settings.enforceNamingConventions = updates.enforceNamingConventions;
    if (updates.namingPatternRegex !== undefined) settings.namingPatternRegex = updates.namingPatternRegex;
    settings.updatedAt = new Date();
    await awaitPersist(settings);
    return settings;
  }

  // --------------------------------------------------------------------------
  // INTERNAL HELPERS
  // --------------------------------------------------------------------------
  private snapshotVersion(
    flagId: string,
    changeType: any,
    changeReason: string,
    changedBy: string
  ) {
    const flag = dbStore.featureFlags.find((f) => f.id === flagId);
    if (!flag) return;

    const environments = dbStore.featureFlagEnvironments.filter((e) => e.featureFlagId === flag.id);
    const rules = dbStore.featureFlagRules.filter((r) =>
      environments.some((e) => e.id === r.featureFlagEnvironmentId)
    );
    const overrides = dbStore.featureFlagOverrides.filter((o) =>
      environments.some((e) => e.id === o.featureFlagEnvironmentId)
    );

    const versionRecord = new FeatureFlagVersion();
    versionRecord.id = uuidv4();
    versionRecord.featureFlagId = flag.id;
    versionRecord.version = flag.version;
    versionRecord.changeType = changeType;
    versionRecord.changeReason = changeReason;
    versionRecord.changedBy = changedBy;
    versionRecord.createdAt = new Date();
    versionRecord.snapshot = {
      flag: { ...flag },
      environments: environments.map((e) => ({ ...e })),
      rules: rules.map((r) => ({ ...r })),
      overrides: overrides.map((o) => ({ ...o })),
    };

    dbStore.featureFlagVersions.push(versionRecord);
  }

  private parseValue(raw: string, type: FlagValueType): any {
    if (type === 'BOOLEAN') {
      return raw === 'true' || raw === '1';
    }
    if (type === 'NUMBER') {
      return Number(raw);
    }
    if (type === 'JSON') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  private evaluateRuleConditions(conditions: RuleCondition[], context: EvaluationContext): boolean {
    if (!conditions || conditions.length === 0) return true;

    for (const cond of conditions) {
      const contextVal = (context as any)[cond.attribute];
      if (contextVal === undefined || contextVal === null) return false;

      const targetVal = cond.value;

      switch (cond.operator) {
        case 'EQUALS':
          if (String(contextVal).toLowerCase() !== String(targetVal).toLowerCase()) return false;
          break;
        case 'NOT_EQUALS':
          if (String(contextVal).toLowerCase() === String(targetVal).toLowerCase()) return false;
          break;
        case 'IN': {
          const list = Array.isArray(targetVal)
            ? targetVal.map((x) => String(x).toLowerCase())
            : String(targetVal).split(',').map((x) => x.trim().toLowerCase());
          if (!list.includes(String(contextVal).toLowerCase())) return false;
          break;
        }
        case 'NOT_IN': {
          const list = Array.isArray(targetVal)
            ? targetVal.map((x) => String(x).toLowerCase())
            : String(targetVal).split(',').map((x) => x.trim().toLowerCase());
          if (list.includes(String(contextVal).toLowerCase())) return false;
          break;
        }
        case 'CONTAINS':
          if (!String(contextVal).toLowerCase().includes(String(targetVal).toLowerCase())) return false;
          break;
        default:
          return false;
      }
    }

    return true;
  }

  private recordMetric(
    flagKey: string,
    environment: EnvironmentName,
    enabled: boolean,
    source: string
  ) {
    let metric = dbStore.featureFlagMetrics.find(
      (m) => m.flagKey === flagKey && m.environment === environment
    );

    if (!metric) {
      metric = new FeatureFlagEvaluationMetric();
      metric.id = uuidv4();
      metric.flagKey = flagKey;
      metric.environment = environment;
      metric.totalEvaluations = 0;
      metric.enabledCount = 0;
      metric.disabledCount = 0;
      metric.defaultedCount = 0;
      metric.overrideCount = 0;
      metric.ruleMatchCount = 0;
      metric.errorCount = 0;
      metric.lastEvaluatedAt = new Date();
      dbStore.featureFlagMetrics.push(metric);
    }

    metric.totalEvaluations += 1;
    if (enabled) metric.enabledCount += 1;
    else metric.disabledCount += 1;

    if (source === 'OVERRIDE') metric.overrideCount += 1;
    else if (source === 'RULE_MATCH') metric.ruleMatchCount += 1;
    else if (source === 'FLAG_DEFAULT' || source === 'ENVIRONMENT_DEFAULT') metric.defaultedCount += 1;
    else if (source === 'FALLBACK_ERROR') metric.errorCount += 1;

    metric.lastEvaluatedAt = new Date();
  }

  private invalidateCache() {
    this.cache.clear();
  }

  // --------------------------------------------------------------------------
  // PRELOAD SEED DATA
  // --------------------------------------------------------------------------
  public async seedDefaultFlagsIfEmpty() {
    if (dbStore.featureFlags.length > 0) return;

    const initialFlags: {
      key: string;
      name: string;
      description: string;
      type: FlagValueType;
      category: FlagCategory;
      ownerTeam: string;
      prodEnabled: boolean;
      prodRollout: number;
      rules?: { name: string; conditions: RuleCondition[]; value: string }[];
    }[] = [
        {
          key: 'affiliate.analytics.v2',
          name: 'Affiliate Analytics Engine V2',
          description: 'Next-generation real-time click and conversion telemetry analytics pipeline.',
          type: 'BOOLEAN',
          category: 'RELEASE',
          ownerTeam: 'Analytics Team',
          prodEnabled: true,
          prodRollout: 25,
        },
        {
          key: 'programs.new-builder',
          name: 'Visual Program Tier Builder',
          description: 'Drag-and-drop tiered commission and bonus rule constructor for enterprise programs.',
          type: 'BOOLEAN',
          category: 'RELEASE',
          ownerTeam: 'Core Platform',
          prodEnabled: true,
          prodRollout: 50,
          rules: [
            {
              name: 'Enterprise Plan Only',
              conditions: [{ attribute: 'plan', operator: 'EQUALS', value: 'enterprise' }],
              value: 'true',
            },
          ],
        },
        {
          key: 'billing.enterprise-contracts',
          name: 'Enterprise Contract & Invoicing',
          description: 'Multi-year commitments, custom milestones, and automated bank reconciliation.',
          type: 'BOOLEAN',
          category: 'RELEASE',
          ownerTeam: 'Billing & Finance',
          prodEnabled: true,
          prodRollout: 100,
        },
        {
          key: 'fraud.advanced-detection',
          name: 'AI Neural Fraud Scoring',
          description: 'Deep neural graph analysis for automated affiliate click fraud and spoofing prevention.',
          type: 'BOOLEAN',
          category: 'OPERATIONAL',
          ownerTeam: 'Risk & Compliance',
          prodEnabled: true,
          prodRollout: 100,
        },
        {
          key: 'api.v2-endpoints',
          name: 'PartnerIQ Public REST API v2',
          description: 'High-speed OpenAPI 3.1 endpoints with streaming webhooks and GraphQL federated mesh.',
          type: 'BOOLEAN',
          category: 'RELEASE',
          ownerTeam: 'Developer Experience',
          prodEnabled: true,
          prodRollout: 10,
        },
        {
          key: 'payouts.instant-settlement',
          name: 'Instant Cross-Border Payouts',
          description: 'Real-time multi-currency affiliate bank account and crypto rail settlements.',
          type: 'BOOLEAN',
          category: 'EXPERIMENT',
          ownerTeam: 'Treasury Ops',
          prodEnabled: false,
          prodRollout: 0,
        },
      ];

    for (const f of initialFlags) {
      this.createFlag(
        {
          key: f.key,
          name: f.name,
          description: f.description,
          type: f.type,
          category: f.category,
          ownerTeam: f.ownerTeam,
          defaultValue: 'false',
          failureBehavior: 'FAIL_CLOSED',
          initialEnvironments: [
            { environment: 'DEVELOPMENT', enabled: true, rolloutPercentage: 100 },
            { environment: 'STAGING', enabled: true, rolloutPercentage: 100 },
            { environment: 'PRODUCTION', enabled: f.prodEnabled, rolloutPercentage: f.prodRollout },
          ],
        },
        'system-seed'
      );

      // Add rules if specified
      if (f.rules) {
        for (let i = 0; i < f.rules.length; i++) {
          const r = f.rules[i];
          await this.setRule(
            f.key,
            'PRODUCTION',
            {
              priority: i + 1,
              name: r.name,
              conditions: r.conditions,
              value: r.value,
              enabled: true,
            },
            'system-seed'
          );
        }
      }

    }
  }
}
