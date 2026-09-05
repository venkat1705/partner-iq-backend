import { Module } from '@nestjs/common';
import { InternalOpsController } from './internal-ops.controller';
import { InternalOpsService } from './internal-ops.service';
import { InternalOpsGuard } from './internal-ops.guard';
import { EmailDesignModule } from '../email-design/email-design.module';

@Module({
  imports: [EmailDesignModule],
  controllers: [InternalOpsController],
  providers: [InternalOpsService, InternalOpsGuard],
  exports: [InternalOpsService, InternalOpsGuard],
})
export class InternalOpsModule { }

