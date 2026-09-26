import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationSettingsController } from './settings/organization-settings.controller';
import { OrganizationSettingsService } from './settings/organization-settings.service';
import { BillingModule } from '../billing/billing.module';
import { EmailDesignModule } from '../email-design/email-design.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { GamificationModule } from '../gamification/gamification.module';

@Module({
  imports: [BillingModule, EmailDesignModule, NotificationsModule, CommissionsModule, GamificationModule],
  controllers: [OrganizationsController, OrganizationSettingsController],
  providers: [OrganizationsService, OrganizationSettingsService],
  exports: [OrganizationsService, OrganizationSettingsService],
})
export class OrganizationsModule { }
