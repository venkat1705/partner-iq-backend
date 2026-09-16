import type { PartnerDealEntity } from '../../database/store';
import { PartnerDealStatus } from '../../common/enums';

export const DEAL_BOARD_COLUMNS = ['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;
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
