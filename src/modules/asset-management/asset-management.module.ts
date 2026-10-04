import { Module } from '@nestjs/common';
import { StorageQuotaModule } from '../storage-quota/storage-quota.module';
import { AffiliateAssetsController } from './affiliate-assets.controller';
import { AffiliateAssetsService } from './affiliate-assets.service';
import { AssetBundlesService } from './asset-bundles.service';
import { AssetManagementController } from './asset-management.controller';
import { AssetManagementService } from './asset-management.service';
import { AssetThumbnailService } from './asset-thumbnail.service';
import { AssetUploadService } from './asset-upload.service';
import { StorageAdminController } from './storage-admin.controller';
import { StorageJobsService } from './storage-jobs.service';

@Module({
  imports: [StorageQuotaModule],
  controllers: [AssetManagementController, AffiliateAssetsController, StorageAdminController],
  providers: [AssetManagementService, AssetBundlesService, AssetUploadService, AssetThumbnailService, AffiliateAssetsService, StorageJobsService],
  exports: [AssetManagementService],
})
export class AssetManagementModule {}
