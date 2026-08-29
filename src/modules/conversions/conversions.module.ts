import { Module } from '@nestjs/common';
import { ConversionsController } from './conversions.controller';
import { ConversionsService } from './conversions.service';
import { FraudModule } from '../fraud/fraud.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { LedgerModule } from '../ledger/ledger.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AutomationsModule } from '../automations/automations.module';

@Module({
  imports: [FraudModule, CommissionsModule, LedgerModule, GamificationModule, AutomationsModule],
  controllers: [ConversionsController],
  providers: [ConversionsService],
  exports: [ConversionsService],
})
export class ConversionsModule {}

