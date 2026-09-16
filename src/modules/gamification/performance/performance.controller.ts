import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { LeaderboardQueryDto, ChangeTierDto } from '../dto/performance.dto';
import { GrantRewardDto } from '../dto/milestone.dto';
import { RewardService } from '../rewards/reward.service';
import { JwtAuthGuard as AuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/organizations/:organizationId/affiliate-performance', 'organizations/:organizationId/affiliate-performance'])
@UseGuards(AuthGuard, OrganizationGuard, RbacGuard)
export class PerformanceController {
  constructor(
    private readonly performanceService: PerformanceService,
    private readonly rewardService: RewardService,
  ) {}

  @Get('summary')
  @RequirePermission('performance.view')
  async getPerformanceSummary(@Param('organizationId') orgId: string, @Query('programId') programId?: string) {
    return this.performanceService.getOrganizationPerformanceOverview(orgId, programId);
  }

  @Get('analytics/funnel')
  @RequirePermission('performance.view')
  async getActivationFunnel(@Param('organizationId') orgId: string, @Query('programId') programId?: string) {
    return this.performanceService.getActivationFunnel(orgId, programId);
  }

  @Get('leaderboard')
  @RequirePermission('performance.view')
  async getLeaderboard(@Param('organizationId') orgId: string, @Query() dto: LeaderboardQueryDto) {
    return this.performanceService.getLeaderboard(orgId, dto);
  }

  @Get(':affiliateId')
  @RequirePermission('performance.view')
  async getAffiliatePerformanceDetail(
    @Param('organizationId') orgId: string,
    @Param('affiliateId') affiliateId: string,
  ) {
    return this.performanceService.getAffiliatePerformanceDetail(orgId, affiliateId);
  }

  @Post(':affiliateId/change-tier')
  @RequirePermission('tiers.assign')
  async changeAffiliateTier(
    @Req() req: any,
    @Param('organizationId') orgId: string,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: ChangeTierDto,
  ) {
    return this.performanceService.changeAffiliateTier(orgId, affiliateId, dto, req.user.id);
  }

  @Post(':affiliateId/grant-reward')
  @RequirePermission('rewards.grant')
  async grantReward(
    @Req() req: any,
    @Param('organizationId') orgId: string,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: GrantRewardDto,
  ) {
    return this.rewardService.grantManualReward(orgId, affiliateId, dto, req.user.id);
  }
}
