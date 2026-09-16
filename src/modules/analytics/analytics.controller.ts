import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentEnvironment } from '../../common/decorators/environment.decorator';
import { EnvironmentType } from '../../common/enums';

@ApiTags('Analytics')
@Controller('api/v1/organizations/:organizationId')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Single source-of-truth organization dashboard overview' })
  getOverview(@Param('organizationId') organizationId: string, @CurrentEnvironment() environment: EnvironmentType) {
    return this.analyticsService.getOrganizationOverview(organizationId, environment);
  }

  @Get('analytics/revenue')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Organization revenue metrics' })
  getRevenue(@Param('organizationId') organizationId: string, @CurrentEnvironment() environment: EnvironmentType) {
    return this.analyticsService.getOrganizationRevenueMetrics(organizationId, environment);
  }

  @Get('analytics/commissions')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Organization commission metrics' })
  getCommissions(@Param('organizationId') organizationId: string, @CurrentEnvironment() environment: EnvironmentType) {
    return this.analyticsService.getOrganizationCommissionMetrics(organizationId, environment);
  }

  @Get('analytics/conversions')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Organization conversion metrics' })
  getConversions(@Param('organizationId') organizationId: string, @CurrentEnvironment() environment: EnvironmentType) {
    return this.analyticsService.getOrganizationConversionMetrics(organizationId, environment);
  }

  @Get('analytics/affiliates')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Organization affiliate metrics' })
  getAffiliateMetrics(@Param('organizationId') organizationId: string, @CurrentEnvironment() environment: EnvironmentType) {
    return this.analyticsService.getOrganizationAffiliateMetrics(organizationId, environment);
  }

  @Get('analytics/payouts')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Organization payout metrics' })
  getPayoutMetrics(@Param('organizationId') organizationId: string, @CurrentEnvironment() environment: EnvironmentType) {
    return this.analyticsService.getOrganizationPayoutMetrics(organizationId, environment);
  }

  @Get('analytics/timeseries')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Monthly revenue/commission/conversion time series for dashboard charts' })
  getTimeSeries(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query('months') months?: string,
  ) {
    const parsedMonths = Math.min(24, Math.max(1, Number(months) || 6));
    return this.analyticsService.getOrganizationRevenueTimeSeries(organizationId, environment, parsedMonths);
  }

  @Get('analytics/top-programs')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Top-performing programs by real attributed revenue' })
  getTopPrograms(@Param('organizationId') organizationId: string, @CurrentEnvironment() environment: EnvironmentType) {
    return this.analyticsService.getOrganizationTopPrograms(organizationId, environment);
  }

  @Get('analytics/mrr')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: "PartnerIQ's own subscription MRR for this organization (never affiliate commission revenue)" })
  getMRR(@Param('organizationId') organizationId: string) {
    return this.analyticsService.getOrganizationMRR(organizationId);
  }

  @Get('analytics/programs/:programId')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Program-scoped analytics' })
  getProgramAnalytics(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.analyticsService.getProgramAnalytics(organizationId, programId, environment);
  }

  @Get('analytics/affiliates/:affiliateId')
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'Affiliate-scoped analytics' })
  getAffiliateAnalytics(
    @Param('organizationId') organizationId: string,
    @Param('affiliateId') affiliateId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.analyticsService.getAffiliateAnalytics(organizationId, affiliateId, environment);
  }
}
