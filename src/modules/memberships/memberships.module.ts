import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailDesignModule } from '../email-design/email-design.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { InvitationsController } from './invitations.controller';
import { BrevoEmailService } from './brevo-email.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  // BillingModule provides SubscriptionLimitService, which gates member
  // invitations on the account-wide member seat allowance.
  imports: [forwardRef(() => AuthModule), EmailDesignModule, NotificationsModule, BillingModule],
  controllers: [MembershipsController, InvitationsController],
  providers: [MembershipsService, BrevoEmailService],
  exports: [MembershipsService, BrevoEmailService],
})
export class MembershipsModule {}
