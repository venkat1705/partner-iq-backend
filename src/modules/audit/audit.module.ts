import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';

@Module({
  controllers: [AuditController, AdminAuditController],
  providers: [AuditService, AdminAuditService],
  exports: [AuditService, AdminAuditService],
})
export class AuditModule { }
