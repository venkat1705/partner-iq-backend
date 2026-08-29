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
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/affiliate-performance', 'affiliate-performance'])
@UseGuards(AuthGuard, RbacGuard)
export class PerformanceController {
  constructor(
    private readonly performanceService: PerformanceService,
    private readonly rewardService: RewardService,
  ) {}

  @Get('summary')
  @RequirePermission('performance.view')
  async getPerformanceSummary(@Req() req: any, @Query('programId') programId?: string) {
    const orgId = req.user.organizationId;
    return this.performanceService.getOrganizationPerformanceOverview(orgId, programId);
  }

  @Get('analytics/funnel')
  @RequirePermission('performance.view')
  async getActivationFunnel(@Req() req: any, @Query('programId') programId?: string) {
    const orgId = req.user.organizationId;
    return this.performanceService.getActivationFunnel(orgId, programId);
  }

  @Get('leaderboard')
  @RequirePermission('performance.view')
  async getLeaderboard(@Req() req: any, @Query() dto: LeaderboardQueryDto) {
    const orgId = req.user.organizationId;
    return this.performanceService.getLeaderboard(orgId, dto);
  }

  @Get(':affiliateId')
  @RequirePermission('performance.view')
  async getAffiliatePerformanceDetail(
    @Req() req: any,
    @Param('affiliateId') affiliateId: string,
  ) {
    const orgId = req.user.organizationId;
    return this.performanceService.getAffiliatePerformanceDetail(orgId, affiliateId);
  }

  @Post(':affiliateId/change-tier')
  @RequirePermission('tiers.assign')
  async changeAffiliateTier(
    @Req() req: any,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: ChangeTierDto,
  ) {
    const orgId = req.user.organizationId;
    return this.performanceService.changeAffiliateTier(orgId, affiliateId, dto, req.user.id);
  }

  @Post(':affiliateId/grant-reward')
  @RequirePermission('rewards.grant')
  async grantReward(
    @Req() req: any,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: GrantRewardDto,
  ) {
    const orgId = req.user.organizationId;
    return this.rewardService.grantManualReward(orgId, affiliateId, dto, req.user.id);
  }
}
