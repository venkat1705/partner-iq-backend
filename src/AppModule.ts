import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { AffiliatesModule } from './modules/affiliates/affiliates.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ConversionsModule } from './modules/conversions/conversions.module';
import { CommissionsModule } from './modules/commissions/commissions.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { BillingModule } from './modules/billing/billing.module';
import { MediaModule } from './modules/media/media.module';
import { DeveloperPlatformModule } from './modules/developer-platform/developer-platform.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AssetManagementModule } from './modules/asset-management/asset-management.module';
import { PartnerDealsModule } from './modules/partner-deals/partner-deals.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { DemoBookingsModule } from './modules/demo-bookings/demo-bookings.module';

@Module({
  imports: [
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    ProgramsModule,
    AffiliatesModule,
    TrackingModule,
    ApiKeysModule,
    ConversionsModule,
    CommissionsModule,
    FraudModule,
    LedgerModule,
    PayoutsModule,
    WebhooksModule,
    AuditModule,
    AdminModule,
    IntegrationsModule,
    BillingModule,
    MediaModule,
    DeveloperPlatformModule,
    NotificationsModule,
    AssetManagementModule,
    PartnerDealsModule,
    GamificationModule,
    AutomationsModule,
    DemoBookingsModule,
  ],
})
export class AppModule {}

