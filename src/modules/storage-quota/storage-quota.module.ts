import { Module } from '@nestjs/common';
import { StorageQuotaService } from './storage-quota.service';

@Module({
  providers: [StorageQuotaService],
  exports: [StorageQuotaService],
})
export class StorageQuotaModule {}
