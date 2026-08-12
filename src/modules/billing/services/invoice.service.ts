import { Injectable } from '@nestjs/common';
import { dbStore } from '../../../database/store';

@Injectable()
export class InvoiceService {
  list(organizationId: string) {
    return dbStore.billingInvoices
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => b.invoiceDate.getTime() - a.invoiceDate.getTime());
  }
}
