import { Module } from '@nestjs/common';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { LedgerModule } from '../ledger/ledger.module';
import { FraudModule } from '../fraud/fraud.module';

@Module({
  imports: [LedgerModule, FraudModule],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
