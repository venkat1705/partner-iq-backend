import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { BillingService } from '../services/billing.service';
import { CheckoutDto, PricingPreviewDto, ValidateBillingCouponDto, VerifyPaymentDto } from '../dto/billing.dto';
import { SubscriptionService } from '../services/subscription.service';
import { PaymentService } from '../services/payment.service';
import { InvoiceService } from '../services/invoice.service';
import { TrialService } from '../services/trial.service';
import { BillingPricingService } from '../services/billing-pricing.service';
import { SubscriptionLimitService } from '../services/subscription-limit.service';

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
    private readonly trialService: TrialService,
    private readonly pricing: BillingPricingService,
    private readonly limits: SubscriptionLimitService,
  ) {}

  @Get('trial')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Get trial status and countdown' })
  getTrialStatus(@Param('organizationId') organizationId: string) {
    return this.trialService.getTrialStatus(organizationId);
  }

  @Post('trial/start')
  @RequirePermissions('billing.subscribe')
  @ApiOperation({ summary: 'Start 14-day free trial for organization' })
  startTrial(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() body?: { planCode?: string },
  ) {
    return this.trialService.startTrial(organizationId, user.userId, body?.planCode);
  }

  @Post('trial/extend')
  @RequirePermissions('billing.manage')
  @ApiOperation({ summary: 'Admin extension of trial' })
  extendTrial(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() body: { days: number },
  ) {
    return this.trialService.extendTrial(organizationId, body.days, user.userId);
  }

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

  @Post('pricing/preview')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Preview authoritative billing price with optional coupon' })
  pricingPreview(@Param('organizationId') organizationId: string, @Body() dto: PricingPreviewDto) {
    return this.pricing.quote({ organizationId, ...dto });
  }

  @Post('coupons/validate')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Validate a PartnerIQ billing coupon and return a safe customer message' })
  validateCoupon(@Param('organizationId') organizationId: string, @Body() dto: ValidateBillingCouponDto) {
    return this.pricing.quote({ organizationId, ...dto });
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

  /**
   * Account-wide usage against effective limits, counted live from the database.
   * Superseded by `GET /organizations/:organizationId/subscription/limits`,
   * which returns the same numbers with full add-on detail; kept so existing
   * clients of this path keep working.
   */
  @Get('usage')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Account-wide resource usage and effective limits' })
  async usage(@Param('organizationId') organizationId: string) {
    const limits = await this.limits.getEffectiveLimitsForOrganization(organizationId);
    return {
      accountId: limits.accountId,
      planCode: limits.planCode,
      organizations: limits.limits.ORGANIZATION,
      programs: limits.limits.PROGRAM,
      affiliates: limits.limits.AFFILIATE,
      members: limits.limits.MEMBER,
    };
  }
}
