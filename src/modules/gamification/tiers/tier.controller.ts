import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { TierService } from './tier.service';
import {
  CreatePartnerTierDto,
  UpdatePartnerTierDto,
  ReorderTiersDto,
  LockTierDto,
} from '../dto/tier.dto';
import { JwtAuthGuard as AuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/partner-tiers', 'partner-tiers'])
@UseGuards(AuthGuard, RbacGuard)
export class TierController {
  constructor(private readonly tierService: TierService) {}

  @Get()
  @RequirePermission('tiers.view')
  async getTiers(@Req() req: any, @Query('programId') programId?: string) {
    const orgId = req.user.organizationId;
    return this.tierService.getTiers(orgId, programId);
  }

  @Post()
  @RequirePermission('tiers.create')
  async createTier(@Req() req: any, @Body() dto: CreatePartnerTierDto) {
    const orgId = req.user.organizationId;
    return this.tierService.createTier(orgId, dto, req.user.id);
  }

  @Get(':id')
  @RequirePermission('tiers.view')
  async getTier(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.tierService.getTier(orgId, id);
  }

  @Patch(':id')
  @RequirePermission('tiers.edit')
  async updateTier(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerTierDto,
  ) {
    const orgId = req.user.organizationId;
    return this.tierService.updateTier(orgId, id, dto, req.user.id);
  }

  @Delete(':id')
  @RequirePermission('tiers.delete')
  async deleteTier(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.tierService.deleteTier(orgId, id, req.user.id);
  }

  @Post('reorder')
  @RequirePermission('tiers.edit')
  async reorderTiers(@Req() req: any, @Body() dto: ReorderTiersDto) {
    const orgId = req.user.organizationId;
    return this.tierService.reorderTiers(orgId, dto.tierIds);
  }

  @Get(':id/affiliates')
  @RequirePermission('tiers.view')
  async getAffiliatesInTier(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.tierService.getAffiliatesInTier(orgId, id);
  }

  @Post(':affiliateId/lock')
  @RequirePermission('tiers.assign')
  async lockTier(
    @Req() req: any,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: LockTierDto,
  ) {
    const orgId = req.user.organizationId;
    return this.tierService.lockTier(orgId, affiliateId, dto, req.user.id);
  }
}
