import { Module } from '@nestjs/common';
import { AssetManagementController } from './asset-management.controller';
import { AssetManagementService } from './asset-management.service';

@Module({
  controllers: [AssetManagementController],
  providers: [AssetManagementService],
  exports: [AssetManagementService],
})
export class AssetManagementModule {}
