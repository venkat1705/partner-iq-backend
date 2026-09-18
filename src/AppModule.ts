import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiThrottlerGuard } from './common/guards/api-throttler.guard';
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
import { TaxCertificatesModule } from './modules/tax-certificates/tax-certificates.module';
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
import { EmailDesignModule } from './modules/email-design/email-design.module';
import { InternalOpsModule } from './modules/internal-ops/internal-ops.module';
import { BrandingModule } from './modules/branding/branding.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { CouponsModule } from './modules/coupons/coupons.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
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
    TaxCertificatesModule,
    IntegrationsModule,
    BillingModule,
    MediaModule,
    DeveloperPlatformModule,
    NotificationsModule,
    AssetManagementModule,
    PartnerDealsModule,
    GamificationModule,
    CouponsModule,
    AutomationsModule,
    DemoBookingsModule,
    EmailDesignModule,
    InternalOpsModule,
    BrandingModule,
    AnalyticsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiThrottlerGuard,
    },
  ],
})
export class AppModule { }

