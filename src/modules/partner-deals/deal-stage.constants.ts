import type { PartnerDealEntity } from '../../database/store';
import { PartnerDealStatus } from '../../common/enums';

export const DEAL_BOARD_COLUMNS = ['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;
export const DealBoardColumn = {
  NEW: 'NEW',
  QUALIFIED: 'QUALIFIED',
  PROPOSAL: 'PROPOSAL',
  NEGOTIATION: 'NEGOTIATION',
  WON: 'WON',
  LOST: 'LOST',
} as const;
export type DealBoardColumn = (typeof DEAL_BOARD_COLUMNS)[number];

export const COLUMN_STATUSES: Record<DealBoardColumn, PartnerDealStatus[]> = {
  NEW: [
    PartnerDealStatus.SUBMITTED,
    PartnerDealStatus.UNDER_REVIEW,
    PartnerDealStatus.APPROVED,
    PartnerDealStatus.SYNC_PENDING,
    PartnerDealStatus.SYNCED,
    PartnerDealStatus.SYNC_ERROR,
  ],
  QUALIFIED: [PartnerDealStatus.QUALIFIED],
  PROPOSAL: [PartnerDealStatus.PROPOSAL],
  NEGOTIATION: [PartnerDealStatus.NEGOTIATION, PartnerDealStatus.IN_PROGRESS],
  WON: [PartnerDealStatus.CLOSED_WON],
  LOST: [PartnerDealStatus.CLOSED_LOST, PartnerDealStatus.REJECTED, PartnerDealStatus.CANCELLED],
};

export const COLUMN_LABELS: Record<DealBoardColumn, string> = {
  NEW: 'New / Submitted',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  WON: 'Closed Won',
  LOST: 'Closed Lost',
};

export const COLUMN_PROBABILITIES: Record<DealBoardColumn, number> = {
  NEW: 0.10,
  QUALIFIED: 0.25,
  PROPOSAL: 0.50,
  NEGOTIATION: 0.75,
  WON: 1.00,
  LOST: 0.00,
};

export const COLUMN_COLORS: Record<DealBoardColumn, string> = {
  NEW: 'hsl(var(--muted-foreground))',
  QUALIFIED: 'hsl(var(--primary))',
  PROPOSAL: '#f97316',
  NEGOTIATION: '#8b5cf6',
  WON: '#10b981',
  LOST: '#ef4444',
};

export function statusToColumn(status: PartnerDealStatus): DealBoardColumn {
  for (const column of DEAL_BOARD_COLUMNS) {
    if (COLUMN_STATUSES[column].includes(status)) return column;
  }
  return 'NEW';
}

export function targetStatusForColumn(column: DealBoardColumn, deal: Pick<PartnerDealEntity, 'crmProvider'>): PartnerDealStatus {
  switch (column) {
    case 'NEW':
      return deal.crmProvider ? PartnerDealStatus.SYNC_PENDING : PartnerDealStatus.SUBMITTED;
    case 'QUALIFIED':
      return PartnerDealStatus.QUALIFIED;
    case 'PROPOSAL':
      return PartnerDealStatus.PROPOSAL;
    case 'NEGOTIATION':
      return PartnerDealStatus.NEGOTIATION;
    case 'WON':
      return PartnerDealStatus.CLOSED_WON;
    case 'LOST':
      return PartnerDealStatus.CLOSED_LOST;
  }
}
