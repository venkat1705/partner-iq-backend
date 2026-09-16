import {
  Controller,
  Get,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { PerformanceService } from '../performance/performance.service';
import { dbStore } from '../../../database/store';
import { JwtAuthGuard as AuthGuard } from '../../../common/guards/jwt-auth.guard';

@Controller(['api/v1/affiliate/me', 'affiliate/me'])
@UseGuards(AuthGuard)
export class AffiliateGamificationController {
  constructor(private readonly performanceService: PerformanceService) {}

  private resolveCurrentAffiliate(req: any) {
    const email = (req.user?.email || '').toLowerCase().trim();
    const orgId = req.user?.organizationId;

    // Find affiliate by email (or user's organization context). No cross-tenant
    // fallback: a session with no matching affiliate record must not silently
    // see the first affiliate in the entire platform's data.
    const affiliate = dbStore.affiliates.find(
      (a) => a.email.toLowerCase() === email && (!orgId || a.organizationId === orgId),
    );

    if (!affiliate) {
      throw new NotFoundException('Affiliate account not found for current session');
    }

    return affiliate;
  }

  @Get('performance')
  async getMyPerformance(@Req() req: any) {
    const affiliate = this.resolveCurrentAffiliate(req);
    return this.performanceService.getAffiliatePerformanceDetail(affiliate.organizationId, affiliate.id);
  }

  @Get('tier-progress')
  async getMyTierProgress(@Req() req: any) {
    const affiliate = this.resolveCurrentAffiliate(req);
    const detail = await this.performanceService.getAffiliatePerformanceDetail(affiliate.organizationId, affiliate.id);
    return detail.tierInfo;
  }

  @Get('milestones')
  async getMyMilestones(@Req() req: any) {
    const affiliate = this.resolveCurrentAffiliate(req);
    const detail = await this.performanceService.getAffiliatePerformanceDetail(affiliate.organizationId, affiliate.id);
    return detail.milestoneProgress;
  }

  @Get('journey')
  async getMyJourney(@Req() req: any) {
    const affiliate = this.resolveCurrentAffiliate(req);
    const detail = await this.performanceService.getAffiliatePerformanceDetail(affiliate.organizationId, affiliate.id);
    return {
      tierJourney: detail.tierJourney,
      currentTier: detail.tierInfo.currentTier,
      nextTier: detail.tierInfo.nextTier,
      progressPercentage: detail.tierInfo.progressPercentage,
      conversionsRemaining: detail.tierInfo.conversionsRemaining,
    };
  }
}
