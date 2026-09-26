import { Module } from '@nestjs/common';
import { AdminSystemHealthController } from './admin-system-health.controller';
import { AdminSystemHealthService } from './admin-system-health.service';

@Module({
  controllers: [AdminSystemHealthController],
  providers: [AdminSystemHealthService],
  exports: [AdminSystemHealthService],
})
export class SystemHealthModule { }

