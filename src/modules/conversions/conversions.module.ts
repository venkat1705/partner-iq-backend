import { Module } from '@nestjs/common';
import { ConversionsController } from './conversions.controller';
import { ConversionsService } from './conversions.service';
import { FraudModule } from '../fraud/fraud.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [FraudModule, CommissionsModule, LedgerModule],
  controllers: [ConversionsController],
  providers: [ConversionsService],
  exports: [ConversionsService],
})
export class ConversionsModule {}
