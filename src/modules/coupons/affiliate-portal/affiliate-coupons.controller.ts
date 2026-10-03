import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { dbStore } from '../../../database/store';
import { CouponsService } from '../coupons.service';

@ApiTags('Affiliate Self Portal')
@Controller(['api/v1/affiliate/me', 'affiliate/me'])
@UseGuards(JwtAuthGuard)
export class AffiliateCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get('assigned-coupons')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List product coupons assigned to the current affiliate' })
  async getAssignedCoupons(@Req() req: any, @Query('organizationId') organizationId?: string) {
    const email = (req.user?.email || '').toLowerCase().trim();
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    if (!email && !userId) {
      throw new BadRequestException('Authenticated affiliate identity is required.');
    }

    // Only affiliate rows that actually belong to the authenticated user are ever considered —
    // this is the ownership boundary, not the optional organizationId query param.
    const myAffiliates = dbStore.affiliates.filter(
      (affiliate) => (userId && affiliate.userId === userId) || (email && affiliate.email.toLowerCase() === email),
    );
    const scoped = organizationId
      ? myAffiliates.filter((affiliate) => affiliate.organizationId === organizationId)
      : myAffiliates;

    // Response contract (portal reads id, organizationId, code, description, discountType, discountValue, validUntil;
    // additive since the coupons audit: name, validFrom, status, uses, conversions, revenueGenerated,
    // commissionEarned, currency). Never other affiliates, limits, or internal ids.
    const lists = await Promise.all(
      scoped.map(async (affiliate) =>
        (await this.couponsService.listForAffiliate(affiliate.organizationId, affiliate.id)).map((coupon) => ({
          ...coupon,
          organizationId: affiliate.organizationId,
        })),
      ),
    );
    return lists.flat();
  }
}
