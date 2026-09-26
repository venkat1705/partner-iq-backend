import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../../common/guards/platform-admin.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { CreateBillingCouponDto, CreatePlanDto, PricingPreviewDto, RefundDto, UpdateBillingCouponDto } from '../dto/billing.dto';
import { PlanService } from '../services/plan.service';
import { AdminBillingService } from '../services/admin-billing.service';
import { PaymentService } from '../services/payment.service';
import { BillingCouponService } from '../services/billing-coupon.service';
import { BillingPricingService } from '../services/billing-pricing.service';
import { BillingCouponStatus } from '../enums/billing.enums';

@ApiTags('Admin Billing')
@Controller('api/v1/admin/billing')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminBillingController {
  constructor(
    private readonly adminBilling: AdminBillingService,
    private readonly plans: PlanService,
    private readonly payments: PaymentService,
    private readonly coupons: BillingCouponService,
    private readonly pricing: BillingPricingService,
  ) { }

  @Get('overview')
  @ApiOperation({ summary: 'Get platform billing analytics' })
  overview() {
    return this.adminBilling.overview();
  }

  @Post('plans')
  @RequirePermissions('billing.admin')
  createPlan(@CurrentUser() user: AuthUserPayload, @Body() dto: CreatePlanDto) {
    return this.plans.createPlan(dto, user.userId);
  }

  @Post('coupons')
  @RequirePermissions('billing.coupons.create')
  createCoupon(@CurrentUser() user: AuthUserPayload, @Body() dto: CreateBillingCouponDto) {
    return this.coupons.create(dto, user.userId);
  }

  @Get('coupons/overview')
  @RequirePermissions('billing.coupons.read')
  couponOverview() {
    return this.coupons.overview();
  }

  @Get('coupons/redemptions/all')
  @RequirePermissions('billing.coupons.redemptions.read')
  allCouponRedemptions() {
    return this.coupons.allRedemptions();
  }

  @Get('coupons/campaigns')
  @RequirePermissions('billing.coupons.read')
  couponCampaigns() {
    return this.coupons.campaigns();
  }

  @Post('coupons/campaigns')
  @RequirePermissions('billing.coupons.create')
  createCouponCampaign(@CurrentUser() user: AuthUserPayload, @Body() dto: any) {
    return this.coupons.createCampaign(dto, user.userId);
  }

  @Get('coupons/exceptions')
  @RequirePermissions('billing.coupons.read')
  couponExceptions() {
    return this.coupons.exceptions();
  }

  @Post('coupons/exceptions/:id/resolve')
  @RequirePermissions('billing.coupons.update')
  resolveCouponException(@Param('id') id: string, @CurrentUser() user: AuthUserPayload, @Body() dto: any) {
    return this.coupons.resolveException(id, dto, user.userId);
  }

  @Get('coupons/audit-logs')
  @RequirePermissions('billing.coupons.read')
  couponAuditLogs() {
    return this.coupons.auditLogs();
  }

  @Get('coupons')
  @RequirePermissions('billing.coupons.read')
  listCoupons(@Query('status') status?: string, @Query('search') search?: string) {
    return this.coupons.list({ status, search });
  }

  @Get('coupons/:id')
  @RequirePermissions('billing.coupons.read')
  getCoupon(@Param('id') id: string) {
    return this.coupons.get(id);
  }

  @Patch('coupons/:id')
  @RequirePermissions('billing.coupons.update')
  updateCoupon(@Param('id') id: string, @CurrentUser() user: AuthUserPayload, @Body() dto: UpdateBillingCouponDto) {
    return this.coupons.update(id, dto, user.userId);
  }

  @Post('coupons/:id/activate')
  @RequirePermissions('billing.coupons.activate')
  activateCoupon(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.coupons.changeStatus(id, BillingCouponStatus.ACTIVE, user.userId);
  }

  @Post('coupons/:id/pause')
  @RequirePermissions('billing.coupons.update')
  pauseCoupon(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.coupons.changeStatus(id, BillingCouponStatus.PAUSED, user.userId);
  }

  @Post('coupons/:id/archive')
  @RequirePermissions('billing.coupons.archive')
  archiveCoupon(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.coupons.changeStatus(id, BillingCouponStatus.ARCHIVED, user.userId);
  }

  @Post('coupons/:id/expire')
  @RequirePermissions('billing.coupons.update')
  expireCoupon(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.coupons.expire(id, user.userId);
  }

  @Post('coupons/:id/duplicate')
  @RequirePermissions('billing.coupons.create')
  duplicateCoupon(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.coupons.duplicate(id, user.userId);
  }

  @Get('coupons/:id/redemptions')
  @RequirePermissions('billing.coupons.redemptions.read')
  couponRedemptions(@Param('id') id: string) {
    return this.coupons.redemptions(id);
  }

  @Get('coupons/:id/analytics')
  @RequirePermissions('billing.coupons.analytics.read')
  couponAnalytics(@Param('id') id: string) {
    return this.coupons.analytics(id);
  }

  @Post('coupons/preview')
  @RequirePermissions('billing.coupons.read')
  couponPreview(@CurrentUser() user: AuthUserPayload, @Body() dto: PricingPreviewDto & { organizationId?: string }) {
    return this.pricing.quote({ organizationId: dto.organizationId || user.organizationId || '', ...dto });
  }


  @Get('subscriptions')
  subscriptions() {
    return this.adminBilling.subscriptions();
  }

  @Get('payments')
  paymentsList() {
    return this.adminBilling.payments();
  }

  @Get('invoices')
  invoices() {
    return this.adminBilling.invoices();
  }

  @Get('entitlements')
  entitlements() {
    return this.adminBilling.entitlements();
  }

  @Get('credits')
  credits() {
    return this.adminBilling.credits();
  }

  @Post('credits')
  @RequirePermissions('billing.admin')
  grantCredit(@CurrentUser() user: AuthUserPayload, @Body() dto: any) {
    return this.adminBilling.grantCredit(dto, user.userId);
  }

  @Get('trials')
  trials() {
    return this.adminBilling.trials();
  }

  @Get('refunds')
  refundsList() {
    return this.adminBilling.refunds();
  }

  @Post('refunds')
  @RequirePermissions('billing.refund')
  refund(@CurrentUser() user: AuthUserPayload, @Body() dto: RefundDto) {
    return this.payments.refund(user.organizationId || '', user.userId, dto.paymentId, dto.amount);
  }

  @Get('exceptions')
  exceptions() {
    return this.adminBilling.exceptions();
  }

  @Post('exceptions/:id/resolve')
  @RequirePermissions('billing.admin')
  resolveException(@Param('id') id: string, @CurrentUser() user: AuthUserPayload, @Body() dto: any) {
    return this.adminBilling.resolveException(id, dto, user.userId);
  }

  @Get('enterprise')
  enterpriseContracts() {
    return this.adminBilling.enterprise();
  }

  @Post('enterprise')
  @RequirePermissions('billing.admin')
  createEnterpriseContract(@CurrentUser() user: AuthUserPayload, @Body() dto: any) {
    return this.adminBilling.createEnterpriseContract(dto, user.userId);
  }

  @Get('providers')
  providers() {
    return this.adminBilling.providers();
  }

  @Get('audit')
  audit() {
    return this.adminBilling.audit();
  }

  @Post('subscriptions/:id/status')
  @RequirePermissions('billing.admin')
  updateSubscriptionStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: any,
  ) {
    return this.adminBilling.updateSubscriptionStatus(id, dto, user.userId);
  }
}

