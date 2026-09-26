import { Controller, Get, Patch, Put, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { AdminService } from './admin.service';
import { AdminPayoutsService } from './admin-payouts.service';
import { AdminOverviewQueryDto } from './dto/admin-query.dto';
import {
  AdminPayoutListQueryDto,
  AdminHoldPayoutDto,
  AdminRetryPayoutDto,
  AdminCancelPayoutDto,
  AdminResolveReconciliationDto,
} from './dto/admin-payout.dto';

@ApiTags('Platform Admin')
@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminPayoutsService: AdminPayoutsService,
  ) { }

  @Get('overview')
  @ApiOperation({ summary: 'Get real platform admin data across all organizations' })
  getOverview(
    @CurrentUser() user: AuthUserPayload,
    @Query() query?: AdminOverviewQueryDto,
  ) {
    return this.adminService.getOverview(user, query);
  }

  @Patch('programs/:id/status')
  @ApiOperation({ summary: 'Update program status as super admin' })
  updateProgramStatus(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.adminService.updateProgramStatus(id, body.status, user);
  }

  @Post('programs/bulk-status')
  @ApiOperation({ summary: 'Bulk update programs status as super admin' })
  bulkUpdateProgramStatus(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: { programIds: string[]; status: string },
  ) {
    return this.adminService.bulkUpdateProgramStatus(body.programIds, body.status, user);
  }

  @Patch('affiliates/:id/status')
  @ApiOperation({ summary: 'Update affiliate status as super admin' })
  updateAffiliateStatus(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.adminService.updateAffiliateStatus(id, body.status, user);
  }

  @Post('affiliates/bulk-status')
  @ApiOperation({ summary: 'Bulk update affiliates status as super admin' })
  bulkUpdateAffiliateStatus(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: { affiliateIds: string[]; status: string },
  ) {
    return this.adminService.bulkUpdateAffiliateStatus(body.affiliateIds, body.status, user);
  }

  @Patch('conversions/:id/status')
  @ApiOperation({ summary: 'Update conversion status as super admin' })
  updateConversionStatus(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: { status: string; reason?: string },
  ) {
    return this.adminService.updateConversionStatus(id, body.status, user, body.reason);
  }

  @Post('conversions/bulk-status')
  @ApiOperation({ summary: 'Bulk update conversions status as super admin' })
  bulkUpdateConversionStatus(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: { conversionIds: string[]; status: string; reason?: string },
  ) {
    return this.adminService.bulkUpdateConversionStatus(body.conversionIds, body.status, user, body.reason);
  }

  @Patch('commissions/:id/status')
  @ApiOperation({ summary: 'Update commission status as super admin' })
  updateCommissionStatus(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: { status: string; reason?: string },
  ) {
    return this.adminService.updateCommissionStatus(id, body.status, user, body.reason);
  }

  @Post('commissions/bulk-status')
  @ApiOperation({ summary: 'Bulk update commissions status as super admin' })
  bulkUpdateCommissionStatus(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: { commissionIds: string[]; status: string; reason?: string },
  ) {
    return this.adminService.bulkUpdateCommissionStatus(body.commissionIds, body.status, user, body.reason);
  }

  @Post('commissions/:id/recalculate')
  @ApiOperation({ summary: 'Recalculate commission based on rules as super admin' })
  recalculateCommission(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
  ) {
    return this.adminService.recalculateCommission(id, user);
  }

  @Post('commissions/:id/reverse')
  @ApiOperation({ summary: 'Reverse commission as super admin' })
  reverseCommission(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.adminService.reverseCommission(id, user, body.reason);
  }

  @Get('affiliates/settings')
  @ApiOperation({ summary: 'Get platform-wide affiliate eligibility settings' })
  getAffiliateSettings(@CurrentUser() user: AuthUserPayload) {
    return this.adminService.getAffiliateSettings(user);
  }

  @Patch('affiliates/settings')
  @ApiOperation({ summary: 'Update platform-wide affiliate eligibility settings' })
  updateAffiliateSettings(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: { allowOrganizationMembers: boolean },
  ) {
    return this.adminService.updateAffiliateSettings(body, user);
  }

  @Put('affiliates/settings')
  @ApiOperation({ summary: 'Update platform-wide affiliate eligibility settings (PUT)' })
  putAffiliateSettings(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: { allowOrganizationMembers: boolean },
  ) {
    return this.adminService.updateAffiliateSettings(body, user);
  }

  /* ── Admin Payouts & Reconciliation Operations ── */

  @Get('payouts')
  @ApiOperation({ summary: 'List platform-wide payout items with server-side filtering & sorting' })
  getPayouts(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: AdminPayoutListQueryDto,
  ) {
    return this.adminPayoutsService.listPayouts(user, query);
  }

  @Get('payouts/analytics')
  @ApiOperation({ summary: 'Get executive Bento KPIs, lifecycle pipeline, and provider metrics' })
  getPayoutAnalytics(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: AdminPayoutListQueryDto,
  ) {
    return this.adminPayoutsService.getAnalytics(user, query);
  }

  @Get('payouts/reconciliation')
  @ApiOperation({ summary: 'Get platform-wide reconciliation summary, discrepancies, and runs' })
  getReconciliationSummary(@CurrentUser() user: AuthUserPayload) {
    return this.adminPayoutsService.getReconciliation(user);
  }

  @Post('payouts/reconciliation/run')
  @ApiOperation({ summary: 'Trigger automated deterministic reconciliation run across all providers' })
  triggerReconciliationRun(@CurrentUser() user: AuthUserPayload) {
    return this.adminPayoutsService.triggerReconciliationRun(user);
  }

  @Post('payouts/reconciliation/:id/resolve')
  @ApiOperation({ summary: 'Manually resolve or match a reconciliation discrepancy with audit reason' })
  resolveReconciliation(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: AdminResolveReconciliationDto,
  ) {
    return this.adminPayoutsService.resolveReconciliation(user, id, body);
  }

  @Get('payouts/export')
  @ApiOperation({ summary: 'Export filtered payouts as CSV' })
  exportPayouts(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: AdminPayoutListQueryDto,
  ) {
    return this.adminPayoutsService.exportPayoutsCsv(user, query);
  }

  @Get('payouts/:id')
  @ApiOperation({ summary: 'Get detailed payout workspace with commissions, provider data, and state machine' })
  getPayoutDetail(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
  ) {
    return this.adminPayoutsService.getPayoutDetail(user, id);
  }

  @Post('payouts/:id/approve')
  @ApiOperation({ summary: 'Approve a payout item for scheduled settlement' })
  approvePayout(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
  ) {
    return this.adminPayoutsService.approvePayout(user, id);
  }

  @Post('payouts/:id/hold')
  @ApiOperation({ summary: 'Place a payout on hold with mandatory reason and compliance notes' })
  holdPayout(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: AdminHoldPayoutDto,
  ) {
    return this.adminPayoutsService.holdPayout(user, id, body);
  }

  @Post('payouts/:id/retry')
  @ApiOperation({ summary: 'Idempotently retry a failed or held payout' })
  retryPayout(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body?: AdminRetryPayoutDto,
  ) {
    return this.adminPayoutsService.retryPayout(user, id, body);
  }

  @Post('payouts/:id/cancel')
  @ApiOperation({ summary: 'Cancel a payout item and restore affiliate balances' })
  cancelPayout(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: AdminCancelPayoutDto,
  ) {
    return this.adminPayoutsService.cancelPayout(user, id, body);
  }
}

