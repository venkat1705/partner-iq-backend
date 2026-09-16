import { Module } from '@nestjs/common';
import { CouponsController } from './coupons.controller';
import { AffiliateCouponsController } from './affiliate-portal/affiliate-coupons.controller';
import { CouponsService } from './coupons.service';
import { EmailDesignModule } from '../email-design/email-design.module';

@Module({
  imports: [EmailDesignModule],
  controllers: [CouponsController, AffiliateCouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
