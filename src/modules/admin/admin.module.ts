import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminPayoutsService } from './admin-payouts.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminPayoutsService],
  exports: [AdminService, AdminPayoutsService],
})
export class AdminModule { }
