import { Module, forwardRef } from '@nestjs/common';
import { ConversionsModule } from '../conversions/conversions.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PartnerDealsController } from './partner-deals.controller';
import { PartnerDealsService } from './partner-deals.service';

@Module({
  imports: [ConversionsModule, forwardRef(() => IntegrationsModule)],
  controllers: [PartnerDealsController],
  providers: [PartnerDealsService],
  exports: [PartnerDealsService],
})
export class PartnerDealsModule {}
