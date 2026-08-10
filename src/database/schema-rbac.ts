import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';
import { RoleType, PolicyEffect, ProgramAccessType, MembershipStatus } from '../common/enums/rbac';

@Entity('roles')
@Unique(['organizationId', 'code'])
export class RoleDefinition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 50, default: RoleType.SYSTEM })
  type!: RoleType;

  @Column({ type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ type: 'boolean', default: true })
  isEditable!: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('permissions')
@Unique(['code'])
export class PermissionDefinition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  resource!: string;

  @Column({ type: 'varchar', length: 100 })
  action!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('role_permissions')
@Unique(['roleId', 'permissionId'])
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  roleId!: string;

  @Index()
  @Column({ type: 'uuid' })
  permissionId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('organization_policies')
export class OrganizationPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 100 })
  resource!: string;

  @Column({ type: 'varchar', length: 100 })
  action!: string;

  @Column({ type: 'simple-json' })
  conditions!: Record<string, any>;

  @Column({ type: 'varchar', length: 50, default: PolicyEffect.ALLOW })
  effect!: PolicyEffect;

  @Column({ type: 'int', default: 100 })
  priority!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string;

  @CreateDateColumn()
  createdAt!: Date;
}

@Entity('organization_invitations')
export class OrganizationInvitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Index()
  @Column({ type: 'uuid' })
  roleId!: string;

  @Column({ type: 'varchar', length: 50, default: ProgramAccessType.ALL })
  programAccessType!: ProgramAccessType;

  @Column({ type: 'simple-array', nullable: true })
  programIds?: string[];

  @Column({ type: 'varchar', length: 255 })
  tokenHash!: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'uuid' })
  invitedBy!: string;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}