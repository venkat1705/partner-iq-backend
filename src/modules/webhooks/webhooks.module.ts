import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { AdminWebhooksController } from './admin-webhooks.controller';
import { AdminWebhooksService } from './admin-webhooks.service';

@Module({
  controllers: [WebhooksController, AdminWebhooksController],
  providers: [WebhooksService, AdminWebhooksService],
  exports: [WebhooksService, AdminWebhooksService],
})
export class WebhooksModule { }
