import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { BillingModule } from '../billing/billing.module';
import { EmailDesignModule } from '../email-design/email-design.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [BillingModule, EmailDesignModule, NotificationsModule, CommissionsModule, GamificationModule],
  controllers: [OrganizationsController],
  // `BillingModule` exports BillingAccountService and SubscriptionLimitService,
  // which OrganizationsService uses to enforce the account-wide organization
  // allowance before inserting a row.
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
