import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export const ServiceCategory = {
  APPLICATION: 'APPLICATION',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  BACKGROUND: 'BACKGROUND',
  EXTERNAL_PROVIDER: 'EXTERNAL_PROVIDER',
} as const;
export type ServiceCategory = (typeof ServiceCategory)[keyof typeof ServiceCategory];

export const ServiceCriticality = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type ServiceCriticality = (typeof ServiceCriticality)[keyof typeof ServiceCriticality];

export const HealthStatus = {
  OPERATIONAL: 'OPERATIONAL',
  DEGRADED: 'DEGRADED',
  PARTIAL_OUTAGE: 'PARTIAL_OUTAGE',
  OUTAGE: 'OUTAGE',
  UNKNOWN: 'UNKNOWN',
  MAINTENANCE: 'MAINTENANCE',
} as const;
export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

export const CheckType = {
  HTTP: 'HTTP',
  DATABASE: 'DATABASE',
  REDIS: 'REDIS',
  QUEUE: 'QUEUE',
  WORKER: 'WORKER',
  CRON: 'CRON',
  EXTERNAL_API: 'EXTERNAL_API',
  STORAGE: 'STORAGE',
} as const;
export type CheckType = (typeof CheckType)[keyof typeof CheckType];

export const IncidentSeverity = {
  SEV_1: 'SEV-1',
  SEV_2: 'SEV-2',
  SEV_3: 'SEV-3',
  SEV_4: 'SEV-4',
} as const;
export type IncidentSeverity = 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4';

export const IncidentStatus = {
  DETECTED: 'DETECTED',
  INVESTIGATING: 'INVESTIGATING',
  IDENTIFIED: 'IDENTIFIED',
  MITIGATING: 'MITIGATING',
  MONITORING: 'MONITORING',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;
export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];

export const DependencyType = {
  HARD: 'HARD',
  SOFT: 'SOFT',
} as const;
export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType];

export const MaintenanceStatus = {
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type MaintenanceStatus = (typeof MaintenanceStatus)[keyof typeof MaintenanceStatus];

@Entity('system_monitored_services')
export class SystemMonitoredService {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  serviceId!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 50, default: 'APPLICATION' })
  category!: ServiceCategory;

  @Column({ type: 'varchar', length: 50, default: 'HIGH' })
  criticality!: ServiceCriticality;

  @Column({ type: 'varchar', length: 50, default: 'OPERATIONAL' })
  status!: HealthStatus;

  @Column({ type: 'float', nullable: true })
  currentLatencyMs?: number;

  @Column({ type: 'float', nullable: true })
  uptimePercentage?: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  lastCheckedAt?: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  lastHealthyAt?: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  version?: string;

  @Column({ type: 'varchar', length: 60, default: 'production' })
  environment!: string;

  @Column({ type: 'varchar', length: 60, default: 'ap-south-1' })
  region!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  hostInfo?: string;

  @Column({ type: 'json', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('system_health_check_results')
export class SystemHealthCheckResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  serviceId!: string;

  @Column({ type: 'varchar', length: 50 })
  checkType!: CheckType;

  @Column({ type: 'varchar', length: 50 })
  status!: HealthStatus;

  @Column({ type: 'float', default: 0 })
  latencyMs!: number;

  @Column({ type: 'int', nullable: true })
  httpCode?: number;

  @Column({ type: 'text', nullable: true })
  errorDetails?: string;

  @Column({ type: 'json', nullable: true })
  metrics?: any;

  @Column({ type: 'varchar', length: 60 })
  checkedAt!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

export interface IncidentTimelineEvent {
  id: string;
  timestamp: string;
  status: IncidentStatus;
  message: string;
  author: string;
}

@Entity('system_incidents')
export class SystemIncident {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 60 })
  incidentNumber!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 50 })
  severity!: IncidentSeverity;

  @Column({ type: 'varchar', length: 50, default: 'DETECTED' })
  status!: IncidentStatus;

  @Column({ type: 'varchar', length: 80, default: 'AUTOMATED_PROBE' })
  detectionSource!: string;

  @Column({ type: 'varchar', length: 60 })
  startedAt!: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  acknowledgedAt?: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  resolvedAt?: string;

  @Column({ type: 'json', nullable: true })
  affectedServices!: string[];

  @Column({ type: 'json', nullable: true })
  affectedDependencies?: string[];

  @Column({ type: 'text', nullable: true })
  impactDescription?: string;

  @Column({ type: 'text', nullable: true })
  rootCause?: string;

  @Column({ type: 'text', nullable: true })
  resolution?: string;

  @Column({ type: 'json', nullable: true })
  timeline!: IncidentTimelineEvent[];

  @Column({ type: 'varchar', length: 120, nullable: true })
  createdBy?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  resolvedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity('system_service_dependencies')
export class SystemServiceDependency {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  sourceServiceId!: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  targetDependencyId!: string;

  @Column({ type: 'varchar', length: 50, default: 'HARD' })
  dependencyType!: DependencyType;

  @Column({ type: 'text', nullable: true })
  impactOnFailure?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('system_deployment_records')
export class SystemDeploymentRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  deploymentId!: string;

  @Column({ type: 'varchar', length: 120 })
  serviceId!: string;

  @Column({ type: 'varchar', length: 60 })
  version!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  commitSha?: string;

  @Column({ type: 'varchar', length: 60, default: 'production' })
  environment!: string;

  @Column({ type: 'varchar', length: 60 })
  deployedAt!: string;

  @Column({ type: 'varchar', length: 50, default: 'SUCCESS' })
  status!: 'SUCCESS' | 'FAILED' | 'ROLLED_BACK' | 'IN_PROGRESS';

  @Column({ type: 'varchar', length: 120, nullable: true })
  deployedBy?: string;

  @Column({ type: 'text', nullable: true })
  healthCorrelationSummary?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('system_maintenance_windows')
export class SystemMaintenanceWindow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 60 })
  startAt!: string;

  @Column({ type: 'varchar', length: 60 })
  endAt!: string;

  @Column({ type: 'json' })
  affectedServices!: string[];

  @Column({ type: 'varchar', length: 50, default: 'SCHEDULED' })
  status!: MaintenanceStatus;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

