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
  ],
})
export class AppModule {}
