import { Module } from '@nestjs/common';
import { DemoBookingsController } from './demo-bookings.controller';
import { DemoBookingsService } from './demo-bookings.service';

@Module({
  controllers: [DemoBookingsController],
  providers: [DemoBookingsService],
  exports: [DemoBookingsService],
})
export class DemoBookingsModule {}
