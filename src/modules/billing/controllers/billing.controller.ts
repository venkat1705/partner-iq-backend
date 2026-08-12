import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { BillingService } from '../services/billing.service';
import { CheckoutDto, VerifyPaymentDto } from '../dto/billing.dto';
import { SubscriptionService } from '../services/subscription.service';
import { PaymentService } from '../services/payment.service';
import { InvoiceService } from '../services/invoice.service';

@ApiTags('Organization Billing')
@Controller('api/v1/organizations/:organizationId/billing')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly subscriptions: SubscriptionService,
    private readonly payments: PaymentService,
    private readonly invoices: InvoiceService,
  ) {}

  @Get('subscription')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Get current organization subscription' })
  subscription(@Param('organizationId') organizationId: string) {
    return this.subscriptions.current(organizationId);
  }

  @Post('checkout')
  @RequirePermissions('billing.subscribe')
  @ApiOperation({ summary: 'Create a checkout session/order using server-side plan pricing' })
  checkout(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.billing.checkout(organizationId, user.userId, dto, idempotencyKey);
  }

  @Post('verify')
  @RequirePermissions('billing.subscribe')
  @ApiOperation({ summary: 'Verify Razorpay checkout signature' })
  verify(@Param('organizationId') organizationId: string, @Body() dto: VerifyPaymentDto) {
    return this.billing.verify(organizationId, dto);
  }

  @Get('payments')
  @RequirePermissions('billing.view')
  paymentsList(@Param('organizationId') organizationId: string) {
    return this.payments.list(organizationId);
  }

  @Get('invoices')
  @RequirePermissions('billing.view')
  invoicesList(@Param('organizationId') organizationId: string) {
    return this.invoices.list(organizationId);
  }

  @Get('usage')
  @RequirePermissions('billing.view')
  usage() {
    return { users: { used: 1 }, programs: { used: 0 } };
  }
}
