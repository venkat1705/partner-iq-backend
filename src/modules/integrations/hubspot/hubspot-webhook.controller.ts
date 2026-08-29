import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { HubSpotWebhookService } from './hubspot-webhook.service';

@Controller('api/v1/integrations/hubspot/webhook')
export class HubSpotWebhookController {
  constructor(private readonly webhooks: HubSpotWebhookService) {}

  @Post()
  receive(@Body() body: any, @Headers() headers: Record<string, any>, @Req() req: Request & { rawBody?: Buffer }) {
    return this.webhooks.receive(body, headers, req.rawBody || Buffer.from(JSON.stringify(body || {})));
  }
}
