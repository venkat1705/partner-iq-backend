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
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/organizations/:organizationId/partner-tiers', 'organizations/:organizationId/partner-tiers'])
@UseGuards(AuthGuard, OrganizationGuard, RbacGuard)
export class TierController {
  constructor(private readonly tierService: TierService) {}

  @Get()
  @RequirePermission('tiers.view')
  async getTiers(@Param('organizationId') orgId: string, @Query('programId') programId?: string) {
    return this.tierService.getTiers(orgId, programId);
  }

  @Post()
  @RequirePermission('tiers.create')
  async createTier(@Req() req: any, @Param('organizationId') orgId: string, @Body() dto: CreatePartnerTierDto) {
    return this.tierService.createTier(orgId, dto, req.user.id);
  }

  @Get(':id')
  @RequirePermission('tiers.view')
  async getTier(@Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.tierService.getTier(orgId, id);
  }

  @Patch(':id')
  @RequirePermission('tiers.edit')
  async updateTier(
    @Req() req: any,
    @Param('organizationId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerTierDto,
  ) {
    return this.tierService.updateTier(orgId, id, dto, req.user.id);
  }

  @Delete(':id')
  @RequirePermission('tiers.delete')
  async deleteTier(@Req() req: any, @Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.tierService.deleteTier(orgId, id, req.user.id);
  }

  @Post('reorder')
  @RequirePermission('tiers.edit')
  async reorderTiers(@Param('organizationId') orgId: string, @Body() dto: ReorderTiersDto) {
    return this.tierService.reorderTiers(orgId, dto.tierIds);
  }

  @Get('assignments/all')
  @RequirePermission('tiers.view')
  async getAffiliateTierAssignments(@Param('organizationId') orgId: string) {
    return this.tierService.getAffiliateTierAssignments(orgId);
  }

  @Get(':id/affiliates')
  @RequirePermission('tiers.view')
  async getAffiliatesInTier(@Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.tierService.getAffiliatesInTier(orgId, id);
  }

  @Post(':affiliateId/lock')
  @RequirePermission('tiers.assign')
  async lockTier(
    @Req() req: any,
    @Param('organizationId') orgId: string,
    @Param('affiliateId') affiliateId: string,
    @Body() dto: LockTierDto,
  ) {
    return this.tierService.lockTier(orgId, affiliateId, dto, req.user.id);
  }
}
