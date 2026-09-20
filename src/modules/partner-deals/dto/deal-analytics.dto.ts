import { IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { DEAL_BOARD_COLUMNS, type DealBoardColumn } from '../deal-stage.constants';

export class DealAnalyticsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['7D', '30D', '90D', '12M', 'LIFETIME'])
  period?: '7D' | '30D' | '90D' | '12M' | 'LIFETIME';

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsUUID()
  affiliateId?: string;

  @IsOptional()
  @IsString()
  crmProvider?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class BulkDealActionDto {
  @IsString()
  @IsIn(['APPROVE', 'REJECT', 'SYNC', 'UPDATE_STAGE', 'ARCHIVE'])
  action!: 'APPROVE' | 'REJECT' | 'SYNC' | 'UPDATE_STAGE' | 'ARCHIVE';

  @IsString({ each: true })
  dealIds!: string[];

  @IsOptional()
  @IsIn(DEAL_BOARD_COLUMNS)
  targetColumn?: DealBoardColumn;

  @IsOptional()
  @IsString()
  reason?: string;
}

export interface DealAnalyticsOverview {
  totalDeals: number;
  openDeals: number;
  wonDeals: number;
  lostDeals: number;
  totalPipelineValue: number;
  weightedPipelineValue: number;
  wonRevenue: number;
  lostValue: number;
  partnerAttributedRevenue: number;
  avgDealSize: number;
  winRate: number;
  attentionCount: number;
  healthSignals: DealHealthSignal[];
  lifecycleDistribution: DealLifecycleStage[];
  activityTrend: DealTimeSeriesPoint[];
  crmSyncStatus: {
    connected: boolean;
    provider?: string;
    lastSyncAt?: string;
    syncedCount: number;
    pendingCount: number;
    errorCount: number;
  };
}

export interface DealHealthSignal {
  id: 'sync-errors' | 'overdue-deals' | 'pending-approval' | 'unattributed' | 'closing-soon';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  count: number;
  actionLabel: string;
}

export interface DealLifecycleStage {
  stage: DealBoardColumn;
  label: string;
  count: number;
  totalValue: number;
  weightedValue: number;
  probability: number;
  percentage: number;
  color: string;
}

export interface DealTimeSeriesPoint {
  date: string;
  pipelineValue: number;
  wonRevenue: number;
  dealsCreated: number;
  dealsWon: number;
}

export interface DealPipelineMetrics {
  stages: DealLifecycleStage[];
  totalPipelineValue: number;
  weightedPipelineValue: number;
  avgDaysToClose: number;
  stageConversionRates: Record<string, number>;
}

export interface DealSyncAnalytics {
  provider: string;
  connected: boolean;
  status: string;
  lastSuccessfulSyncAt?: string;
  lastFailedSyncAt?: string;
  lastError?: string;
  totalSynced: number;
  totalErrors: number;
  totalPending: number;
  successRate: number;
  recentLogs: Array<{
    id: string;
    operation: string;
    direction: 'INBOUND' | 'OUTBOUND';
    status: 'SUCCEEDED' | 'FAILED';
    durationMs?: number;
    errorCode?: string;
    errorMessage?: string;
    createdAt: string;
    entityId?: string;
    externalEntityId?: string;
  }>;
}

export interface DealDossierResponse {
  deal: any;
  affiliate?: {
    id: string;
    displayName: string;
    email: string;
    companyName?: string;
  };
  program?: {
    id: string;
    name: string;
    slug: string;
    currency: string;
  };
  attribution?: {
    model: string;
    status: string;
    attributedAt?: string;
    clickId?: string;
    trackingLinkId?: string;
    shortCode?: string;
    destinationUrl?: string;
  };
  conversions: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
  }>;
  commissions: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
  }>;
  syncHistory: Array<{
    id: string;
    operation: string;
    direction: string;
    status: string;
    durationMs?: number;
    errorCode?: string;
    errorMessage?: string;
    createdAt: string;
  }>;
  stageHistory: Array<{
    column: DealBoardColumn;
    changedAt: string;
    changedBy: string;
    reason?: string;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    actorId: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
}

