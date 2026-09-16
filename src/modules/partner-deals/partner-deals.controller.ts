import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { CreatePartnerDealDto, RejectPartnerDealDto, UpdateDealStageDto } from './dto/partner-deal.dto';
import { PartnerDealsService } from './partner-deals.service';

@ApiTags('Partner B2B Deals')
@Controller('api/v1/organizations/:organizationId/partner-deals')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class PartnerDealsController {
  constructor(private readonly partnerDeals: PartnerDealsService) {}

  @Post()
  @RequirePermissions('deals.create')
  create(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: CreatePartnerDealDto) {
    return this.partnerDeals.create(organizationId, user, dto);
  }

  @Get()
  @RequirePermissions('deals.view')
  list(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Query('crmOnly') crmOnly?: string) {
    return this.partnerDeals.list(organizationId, user, { crmOnly: crmOnly === 'true' });
  }

  @Post('sync-now')
  @RequirePermissions('deals.sync')
  syncNow(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload) {
    return this.partnerDeals.syncAllFromHubSpot(organizationId, user);
  }

  @Get(':dealId')
  @RequirePermissions('deals.view')
  get(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Param('dealId') dealId: string) {
    return this.partnerDeals.get(organizationId, user, dealId);
  }

  @Post(':dealId/approve')
  @RequirePermissions('deals.approve')
  approve(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Param('dealId') dealId: string) {
    return this.partnerDeals.approve(organizationId, user, dealId);
  }

  @Post(':dealId/reject')
  @RequirePermissions('deals.reject')
  reject(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Param('dealId') dealId: string,
    @Body() dto: RejectPartnerDealDto,
  ) {
    return this.partnerDeals.reject(organizationId, user, dealId, dto);
  }

  @Post(':dealId/sync')
  @RequirePermissions('deals.sync')
  sync(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Param('dealId') dealId: string) {
    return this.partnerDeals.sync(organizationId, user, dealId);
  }

  @Patch(':dealId/stage')
  @RequirePermissions('deals.edit')
  updateStage(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Param('dealId') dealId: string,
    @Body() dto: UpdateDealStageDto,
  ) {
    return this.partnerDeals.updateStage(organizationId, user, dealId, dto);
  }

  @Get(':dealId/sync-history')
  @RequirePermissions('deals.view')
  syncHistory(@Param('organizationId') organizationId: string, @Param('dealId') dealId: string) {
    return this.partnerDeals.syncHistory(organizationId, dealId);
  }
}
