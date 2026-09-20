import { IsOptional, IsString, IsEnum, IsArray } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class ProgramAnalyticsQueryDto {
  @ApiPropertyOptional({ example: '30D', description: 'Period: 7D, 30D, 90D, 12M, LIFETIME' })
  @IsOptional()
  @IsString()
  period?: string;

  @ApiPropertyOptional({ description: 'Start date ISO string' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'End date ISO string' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Filter by specific program ID' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiPropertyOptional({ description: 'Filter by program status: ACTIVE, PAUSED, DRAFT, ARCHIVED' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by program type: AFFILIATE, INFLUENCER, REFERRAL, etc.' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Sort by field: revenue, conversions, affiliates, name' })
  @IsOptional()
  @IsString()
  sortBy?: string;
}

export class BulkProgramActionDto {
  @ApiProperty({ enum: ['ACTIVATE', 'PAUSE', 'ARCHIVE'], example: 'PAUSE' })
  @IsString()
  action!: 'ACTIVATE' | 'PAUSE' | 'ARCHIVE';

  @ApiProperty({ type: [String], example: ['prog-1', 'prog-2'] })
  @IsArray()
  programIds!: string[];
}

export class DuplicateProgramDto {
  @ApiProperty({ example: 'Summer Campaign 2026' })
  @IsString()
  newName!: string;

  @ApiProperty({ example: 'summer-campaign-2026' })
  @IsString()
  newSlug!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  copyRules?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  copyTiers?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  copyMilestones?: boolean;
}

export interface ProgramHealthSignal {
  id: string;
  type: 'WARNING' | 'INFO' | 'SUCCESS';
  title: string;
  description: string;
  count: number;
  programIds: string[];
  actionLabel: string;
  actionFilter?: Record<string, string>;
}

export interface ProgramLifecycleStage {
  stage: 'DRAFT' | 'CONFIGURED' | 'PUBLISHED' | 'RECRUITING' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  label: string;
  count: number;
  percentage: number;
}

export interface ProgramTimeSeriesPoint {
  date: string;
  revenue: number;
  conversions: number;
  commission: number;
  clicks: number;
  affiliates: number;
  payouts: number;
}

export interface ProgramAnalyticsOverview {
  totalPrograms: number;
  activePrograms: number;
  pausedPrograms: number;
  draftPrograms: number;
  archivedPrograms: number;
  recruitingPrograms: number;
  totalAffiliates: number;
  activeAffiliates: number;
  totalConversions: number;
  totalClicks: number;
  conversionRate: number;
  grossRevenue: number;
  commissionGenerated: number;
  pendingCommission: number;
  totalPayouts: number;
  averageProgramRevenue: number;
  healthSignals: ProgramHealthSignal[];
  lifecycleDistribution: ProgramLifecycleStage[];
  activityTrend: ProgramTimeSeriesPoint[];
}

export interface ProgramPerformanceItem {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  visibility: string;
  currency: string;
  commissionType: string;
  defaultCommissionValue: number;
  createdAt: string;
  updatedAt: string;
  affiliatesCount: number;
  activeAffiliatesCount: number;
  trackingLinksCount: number;
  clicksCount: number;
  conversionsCount: number;
  revenue: number;
  commission: number;
  pendingCommission: number;
  payouts: number;
  conversionRate: number;
  healthStatus: 'HEALTHY' | 'NEEDS_ATTENTION' | 'DRAFT' | 'INACTIVE';
  setupCompletionScore: number;
}

export interface ProgramSetupChecklistItem {
  key: string;
  label: string;
  completed: boolean;
  description: string;
}

export interface ProgramDetailAnalytics {
  program: any;
  metrics: {
    affiliates: number;
    activeAffiliates: number;
    trackingLinks: number;
    clicks: number;
    conversions: number;
    revenue: number;
    commission: number;
    pendingCommission: number;
    payouts: number;
    conversionRate: number;
    averageOrderValue: number;
  };
  healthIssues: string[];
  setupChecklist: ProgramSetupChecklistItem[];
  topAffiliates: Array<{
    id: string;
    displayName: string;
    email: string;
    conversions: number;
    revenue: number;
    commission: number;
  }>;
  recentConversions: Array<{
    id: string;
    amount: number;
    commissionAmount: number;
    status: string;
    affiliateName?: string;
    createdAt: string;
  }>;
  trackingLinks: Array<{
    id: string;
    shortCode: string;
    destinationUrl: string;
    clicks: number;
    conversions: number;
  }>;
  commissionRulesCount: number;
  partnerTiersCount: number;
  milestonesCount: number;
  timeSeries: ProgramTimeSeriesPoint[];
}

export interface ProgramActivityLogItem {
  id: string;
  action: string;
  actorId: string;
  actorName?: string;
  programId: string;
  programName?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

