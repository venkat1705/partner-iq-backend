import { Module } from '@nestjs/common';
import { FraudModule } from '../fraud/fraud.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { GamificationModule } from '../gamification/gamification.module';
import { AutomationsModule } from '../automations/automations.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [FraudModule, GamificationModule, AutomationsModule, AuditModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}

