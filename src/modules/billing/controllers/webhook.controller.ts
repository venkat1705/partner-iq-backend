import { Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { BillingWebhookService } from '../services/webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('Payment Webhooks')
@Controller('api/v1/webhooks/payments')
export class BillingWebhookController {
  constructor(private readonly webhooks: BillingWebhookService) {}

  @Post('razorpay')
  @ApiOperation({ summary: 'Receive Razorpay payment webhooks with raw-body signature verification' })
  razorpay(@Req() req: RawBodyRequest, @Headers('x-razorpay-signature') signature: string) {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');
    return this.webhooks.handleRazorpay(rawBody, signature || '');
  }
}
