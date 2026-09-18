import { Module, forwardRef } from '@nestjs/common';
import { AffiliatesController } from './affiliates.controller';
import { AffiliatePortalController } from './affiliate-portal.controller';
import { AffiliatesService } from './affiliates.service';
import { AffiliateAuthController } from './auth/affiliate-auth.controller';
import { AffiliateAuthService } from './auth/affiliate-auth.service';
import { MembershipsModule } from '../memberships/memberships.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AutomationsModule } from '../automations/automations.module';
import { AuthModule } from '../auth/auth.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { EmailDesignModule } from '../email-design/email-design.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingModule } from '../billing/billing.module';
import { MediaModule } from '../media/media.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  // BillingModule provides SubscriptionLimitService, which gates affiliate
  // creation and invitation on the account-wide affiliate allowance.
  imports: [MembershipsModule, GamificationModule, AutomationsModule, forwardRef(() => AuthModule), WebhooksModule, EmailDesignModule, NotificationsModule, BillingModule, MediaModule, AuditModule],
  controllers: [AffiliatesController, AffiliatePortalController, AffiliateAuthController],
  providers: [AffiliatesService, AffiliateAuthService],
  exports: [AffiliatesService],
})
export class AffiliatesModule { }

