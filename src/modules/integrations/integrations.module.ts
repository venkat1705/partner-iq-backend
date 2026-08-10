import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationCredentialService } from './integration-credential.service';
import { IntegrationsService } from './integrations.service';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationCredentialService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
