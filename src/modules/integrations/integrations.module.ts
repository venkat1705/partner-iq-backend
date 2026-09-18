import { Module, forwardRef } from '@nestjs/common';
import { PartnerDealsModule } from '../partner-deals/partner-deals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailDesignModule } from '../email-design/email-design.module';
import { ConversionsModule } from '../conversions/conversions.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationCredentialService } from './integration-credential.service';
import { IntegrationsService } from './integrations.service';
import { HubSpotApiClient } from './hubspot/hubspot-api.client';
import { HubSpotController } from './hubspot/hubspot.controller';
import { HubSpotService } from './hubspot/hubspot.service';
import { HubSpotTokenService } from './hubspot/hubspot-token.service';
import { HubSpotWebhookController } from './hubspot/hubspot-webhook.controller';
import { HubSpotWebhookService } from './hubspot/hubspot-webhook.service';
import { HubSpotProvider } from './providers/hubspot.provider';
import { ZohoCrmProvider } from './providers/zoho-crm.provider';
import { RazorpayProvider } from './providers/razorpay.provider';
import { RazorpayTokenService } from './razorpay/razorpay-token.service';
import { CashfreeProvider } from './providers/cashfree.provider';
import { IntegrationProviderFactory } from './providers/provider.factory';

@Module({
  imports: [forwardRef(() => PartnerDealsModule), NotificationsModule, EmailDesignModule, ConversionsModule],
  controllers: [IntegrationsController, HubSpotController, HubSpotWebhookController],
  providers: [
    IntegrationsService,
    IntegrationCredentialService,
    HubSpotService,
    HubSpotTokenService,
    HubSpotApiClient,
    HubSpotWebhookService,
    HubSpotProvider,
    ZohoCrmProvider,
    RazorpayProvider,
    RazorpayTokenService,
    CashfreeProvider,
    IntegrationProviderFactory,
  ],
  exports: [
    IntegrationsService,
    IntegrationCredentialService,
    HubSpotService,
    HubSpotTokenService,
    HubSpotApiClient,
    RazorpayTokenService,
    IntegrationProviderFactory,
  ],
})
export class IntegrationsModule { }
