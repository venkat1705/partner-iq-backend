import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminApiActivityController } from './admin-api-activity.controller';
import { AdminApiActivityService } from './admin-api-activity.service';
import { ApiTelemetryInterceptor } from './api-telemetry.interceptor';

@Module({
  controllers: [AdminApiActivityController],
  providers: [
    AdminApiActivityService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiTelemetryInterceptor,
    },
  ],
  exports: [AdminApiActivityService],
})
export class AdminApiActivityModule { }

