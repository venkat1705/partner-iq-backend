import { Module } from '@nestjs/common';
import { AdminJobsController } from './admin-jobs.controller';
import { AdminJobsService } from './admin-jobs.service';

@Module({
  controllers: [AdminJobsController],
  providers: [AdminJobsService],
  exports: [AdminJobsService],
})
export class AdminJobsModule { }

