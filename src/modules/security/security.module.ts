import { Module } from '@nestjs/common';
import { AdminSecurityController } from './admin-security.controller';
import { AdminSecurityService } from './admin-security.service';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [AdminSecurityController],
  providers: [AdminSecurityService],
  exports: [AdminSecurityService],
})
export class SecurityOperationsModule { }

