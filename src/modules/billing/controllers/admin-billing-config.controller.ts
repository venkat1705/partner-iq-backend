import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../../common/guards/platform-admin.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import {
  UpdateAddonConfigDto,
  UpdateBillingTaxDto,
  UpdatePlanConfigDto,
} from '../dto/addon.dto';
import { AdminBillingConfigService } from '../services/admin-billing-config.service';

/**
 * Platform-admin configuration for the commercial model: plan prices, included
 * allowances, add-on prices and availability, feature flags, and tax.
 *
 * Restricted to PartnerIQ platform admins by `PlatformAdminGuard` — this is not
 * reachable by a customer organization's owner.
 */
@ApiTags('Admin Billing Configuration')
@Controller('api/v1/admin/billing/configuration')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminBillingConfigController {
  constructor(private readonly config: AdminBillingConfigService) {}

  @Get()
  @RequirePermissions('billing.admin')
  @ApiOperation({ summary: 'Read every plan, allowance, add-on and tax setting' })
  get() {
    return this.config.getConfiguration();
  }

  @Patch('plans/:planId')
  @RequirePermissions('billing.admin')
  @ApiOperation({ summary: 'Update a plan price, allowances, or feature flags' })
  updatePlan(
    @Param('planId') planId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdatePlanConfigDto,
  ) {
    return this.config.updatePlan(planId, dto, user.userId);
  }

  @Patch('addons/:addonId')
  @RequirePermissions('billing.admin')
  @ApiOperation({ summary: 'Update an add-on price, quantity range, or availability' })
  updateAddon(
    @Param('addonId') addonId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateAddonConfigDto,
  ) {
    return this.config.updateAddon(addonId, dto, user.userId);
  }

  @Patch('tax')
  @RequirePermissions('billing.admin')
  @ApiOperation({ summary: 'Update the tax rate applied to subscriptions and add-ons' })
  updateTax(@CurrentUser() user: AuthUserPayload, @Body() dto: UpdateBillingTaxDto) {
    return this.config.updateTax(dto, user.userId);
  }
}
