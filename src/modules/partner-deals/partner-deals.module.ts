import { Module, forwardRef } from '@nestjs/common';
import { ConversionsModule } from '../conversions/conversions.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PartnerDealsController } from './partner-deals.controller';
import { PartnerDealsService } from './partner-deals.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ConversionsModule, forwardRef(() => IntegrationsModule), NotificationsModule, RealtimeModule],
  controllers: [PartnerDealsController],
  providers: [PartnerDealsService],
  exports: [PartnerDealsService],
})
export class PartnerDealsModule {}
