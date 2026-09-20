import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { CouponsService } from './coupons.service';
import {
  AssignCouponDto,
  ChangeCouponStatusDto,
  CreateCouponDto,
  UpdateCouponDto,
  UpdateCouponSettingsDto,
} from './dto/coupon.dto';

@ApiTags('Organization Coupons')
@Controller('api/v1/organizations/:organizationId/coupons')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) { }

  @Get('settings')
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'Get whether coupons are enabled for this organization' })
  getSettings(@Param('organizationId') organizationId: string) {
    return this.couponsService.getSettings(organizationId);
  }

  @Put('settings')
  @RequirePermissions('coupons.settings.update')
  @ApiOperation({ summary: 'Enable or disable coupon accessibility for this organization' })
  updateSettings(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateCouponSettingsDto,
  ) {
    return this.couponsService.upsertSettings(organizationId, user.userId, dto);
  }

  @Get('analytics/overview')
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'Get coupon analytics overview and KPI metrics' })
  getAnalyticsOverview(
    @Param('organizationId') organizationId: string,
    @Query('period') period?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('programId') programId?: string,
    @Query('affiliateId') affiliateId?: string,
  ) {
    return this.couponsService.getAnalyticsOverview(organizationId, {
      period,
      dateFrom,
      dateTo,
      programId,
      affiliateId,
    });
  }

  @Get('analytics/performance')
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'Get coupon performance analytics rankings' })
  getPerformanceAnalytics(
    @Param('organizationId') organizationId: string,
    @Query('programId') programId?: string,
    @Query('affiliateId') affiliateId?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    return this.couponsService.getPerformanceAnalytics(organizationId, {
      programId,
      affiliateId,
      sortBy,
    });
  }

  @Get('analytics/by-affiliate')
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'Get coupon attribution grouped by affiliate' })
  getAffiliatePerformance(
    @Param('organizationId') organizationId: string,
    @Query('programId') programId?: string,
  ) {
    return this.couponsService.getAffiliatePerformance(organizationId, { programId });
  }

  @Get('analytics/by-program')
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'Get coupon attribution grouped by program' })
  getProgramPerformance(@Param('organizationId') organizationId: string) {
    return this.couponsService.getProgramPerformance(organizationId);
  }

  @Get('analytics/activity')
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'Get coupon activity and audit logs' })
  getActivityLog(
    @Param('organizationId') organizationId: string,
    @Query('couponId') couponId?: string,
  ) {
    return this.couponsService.getActivityLog(organizationId, couponId);
  }

  @Get('validate/:code')
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'Validate coupon code eligibility in real time' })
  validateCoupon(
    @Param('organizationId') organizationId: string,
    @Param('code') code: string,
  ) {
    return this.couponsService.validateCouponCode(organizationId, code);
  }

  @Get()
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'List coupons for this organization' })
  list(@Param('organizationId') organizationId: string) {
    return this.couponsService.list(organizationId);
  }

  @Post()
  @RequirePermissions('coupons.create')
  @ApiOperation({ summary: 'Create a coupon' })
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateCouponDto,
  ) {
    return this.couponsService.create(organizationId, user.userId, dto);
  }

  @Get(':couponId/analytics')
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'Get detailed analytics for a single coupon' })
  getCouponAnalytics(
    @Param('organizationId') organizationId: string,
    @Param('couponId') couponId: string,
  ) {
    return this.couponsService.getCouponDetailAnalytics(organizationId, couponId);
  }

  @Get(':couponId')
  @RequirePermissions('coupons.view')
  @ApiOperation({ summary: 'Get a single coupon with its assigned affiliates' })
  get(@Param('organizationId') organizationId: string, @Param('couponId') couponId: string) {
    return this.couponsService.get(organizationId, couponId);
  }

  @Put(':couponId')
  @RequirePermissions('coupons.edit')
  @ApiOperation({ summary: 'Update a coupon' })
  update(
    @Param('organizationId') organizationId: string,
    @Param('couponId') couponId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.couponsService.update(organizationId, user.userId, couponId, dto);
  }

  @Post(':couponId/status')
  @RequirePermissions('coupons.edit')
  @ApiOperation({ summary: 'Activate, pause, or archive a coupon' })
  changeStatus(
    @Param('organizationId') organizationId: string,
    @Param('couponId') couponId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ChangeCouponStatusDto,
  ) {
    return this.couponsService.changeStatus(organizationId, user.userId, couponId, dto);
  }

  @Post(':couponId/assign')
  @RequirePermissions('coupons.assign')
  @ApiOperation({ summary: 'Assign a coupon to one or more affiliates' })
  assign(
    @Param('organizationId') organizationId: string,
    @Param('couponId') couponId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: AssignCouponDto,
  ) {
    return this.couponsService.assign(organizationId, user.userId, couponId, dto);
  }

  @Delete(':couponId/assign/:affiliateId')
  @RequirePermissions('coupons.assign')
  @ApiOperation({ summary: 'Unassign a coupon from an affiliate' })
  unassign(
    @Param('organizationId') organizationId: string,
    @Param('couponId') couponId: string,
    @Param('affiliateId') affiliateId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.couponsService.unassign(organizationId, user.userId, couponId, affiliateId);
  }
}
