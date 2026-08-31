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
  ) {}

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

  @Post('refunds')
  @RequirePermissions('billing.refund')
  refund(@CurrentUser() user: AuthUserPayload, @Body() dto: RefundDto) {
    return this.payments.refund(user.organizationId || '', user.userId, dto.paymentId, dto.amount);
  }
}
