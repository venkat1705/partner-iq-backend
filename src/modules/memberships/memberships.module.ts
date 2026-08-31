import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { InvitationsController } from './invitations.controller';
import { BrevoEmailService } from './brevo-email.service';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [MembershipsController, InvitationsController],
  providers: [MembershipsService, BrevoEmailService],
  exports: [MembershipsService, BrevoEmailService],
})
export class MembershipsModule {}
