import { Module } from '@nestjs/common';
import { TrackingModule } from '../tracking/tracking.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { DeveloperPlatformController } from './developer-platform.controller';
import { DeveloperPlatformService } from './developer-platform.service';

@Module({
  imports: [TrackingModule, WebhooksModule],
  controllers: [DeveloperPlatformController],
  providers: [DeveloperPlatformService],
})
export class DeveloperPlatformModule {}
