import { Module } from '@nestjs/common';
import { PlatformGovernanceController } from './governance.controller';
import { PlatformGovernanceService } from './governance.service';

@Module({
  controllers: [PlatformGovernanceController],
  providers: [PlatformGovernanceService],
  exports: [PlatformGovernanceService],
})
export class PlatformGovernanceModule { }

