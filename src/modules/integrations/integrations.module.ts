import { Module, forwardRef } from '@nestjs/common';
import { PartnerDealsModule } from '../partner-deals/partner-deals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationCredentialService } from './integration-credential.service';
import { IntegrationsService } from './integrations.service';
import { HubSpotApiClient } from './hubspot/hubspot-api.client';
import { HubSpotController } from './hubspot/hubspot.controller';
import { HubSpotService } from './hubspot/hubspot.service';
import { HubSpotTokenService } from './hubspot/hubspot-token.service';
import { HubSpotWebhookController } from './hubspot/hubspot-webhook.controller';
import { HubSpotWebhookService } from './hubspot/hubspot-webhook.service';

@Module({
  imports: [forwardRef(() => PartnerDealsModule), NotificationsModule],
  controllers: [IntegrationsController, HubSpotController, HubSpotWebhookController],
  providers: [IntegrationsService, IntegrationCredentialService, HubSpotService, HubSpotTokenService, HubSpotApiClient, HubSpotWebhookService],
  exports: [IntegrationsService, IntegrationCredentialService, HubSpotService, HubSpotTokenService, HubSpotApiClient],
})
export class IntegrationsModule {}
