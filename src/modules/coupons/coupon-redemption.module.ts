import { Module } from '@nestjs/common';
import { CouponRedemptionService } from './coupon-redemption.service';

/** Standalone (no imports) so the conversions pipeline can use it without a module cycle. */
@Module({
  providers: [CouponRedemptionService],
  exports: [CouponRedemptionService],
})
export class CouponRedemptionModule {}
