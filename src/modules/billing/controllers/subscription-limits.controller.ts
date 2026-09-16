import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { BillingInterval } from '../enums/billing.enums';
import {
  CancelAddonDto,
  PreviewAddonDto,
  PurchaseAddonDto,
  UpdateAddonQuantityDto,
} from '../dto/addon.dto';
import { BillingAccountService } from '../services/billing-account.service';
import { SubscriptionLimitService } from '../services/subscription-limit.service';
import { SubscriptionUsageService } from '../services/subscription-usage.service';
import { AddonService } from '../services/addon.service';

/**
 * Subscription capacity, usage, and add-on management for one organization's
 * account.
 *
 * Every route is scoped by `:organizationId` so `OrganizationGuard` enforces
 * tenant isolation exactly as it does everywhere else, and the account is then
 * resolved from that organization — a member of one account can never read or
 * change another account's billing. Reads need `billing.view`; anything that
 * spends money needs `billing.subscribe` or `billing.manage`, which only owners
 * and admins hold.
 */
@ApiTags('Subscription Limits & Add-ons')
@Controller('api/v1/organizations/:organizationId/subscription')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class SubscriptionLimitsController {
  constructor(
    private readonly accounts: BillingAccountService,
    private readonly limits: SubscriptionLimitService,
    private readonly usage: SubscriptionUsageService,
    private readonly addons: AddonService,
  ) {}

  @Get('account')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Resolve the customer account that owns this organization' })
  async account(@Param('organizationId') organizationId: string) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    const organizations = await this.accounts.listOrganizations(account.id);
    return {
      id: account.id,
      name: account.name,
      ownerUserId: account.ownerUserId,
      currency: account.currency,
      status: account.status,
      organizations: organizations.map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        status: item.status,
      })),
    };
  }

  @Get('usage')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Account-wide resource usage, counted live from the database' })
  async getUsage(@Param('organizationId') organizationId: string) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.usage.getUsageBreakdown(account.id);
  }

  @Get('limits')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Effective limits (plan allowance + purchased add-ons) and usage' })
  async getLimits(@Param('organizationId') organizationId: string) {
    return this.limits.getEffectiveLimitsForOrganization(organizationId);
  }

  @Get('summary')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Recurring amount: base plan + active add-ons + tax' })
  async summary(@Param('organizationId') organizationId: string) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.addons.getRecurringSummary(account.id);
  }

  @Get('addons')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Add-on catalog available to this account' })
  async listAddons(
    @Param('organizationId') organizationId: string,
    @Query('billingInterval') billingInterval?: BillingInterval,
  ) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    const entitlement = await this.limits.resolveEntitlement(account.id);
    const interval =
      billingInterval ||
      ((entitlement.subscription?.billingInterval as BillingInterval) ?? BillingInterval.MONTHLY);
    return this.addons.listAddons(interval);
  }

  @Get('addons/purchased')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Add-ons this account has purchased' })
  async purchasedAddons(@Param('organizationId') organizationId: string) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.addons.listPurchases(account.id);
  }

  @Post('addons/preview')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Price an add-on purchase server-side without charging' })
  async previewAddons(
    @Param('organizationId') organizationId: string,
    @Body() dto: PreviewAddonDto,
  ) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.addons.preview(account.id, dto);
  }

  @Post('addons/purchase')
  @RequirePermissions('billing.subscribe')
  @ApiOperation({ summary: 'Start checkout for additional capacity' })
  async purchaseAddons(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: PurchaseAddonDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.addons.purchase(account.id, organizationId, user.userId, dto, idempotencyKey);
  }

  @Patch('addons/:purchaseId')
  @RequirePermissions('billing.manage')
  @ApiOperation({ summary: 'Reduce a purchased add-on quantity' })
  async updateAddon(
    @Param('organizationId') organizationId: string,
    @Param('purchaseId') purchaseId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateAddonQuantityDto,
  ) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.addons.updateQuantity(account.id, purchaseId, organizationId, user.userId, dto);
  }

  @Delete('addons/:purchaseId')
  @RequirePermissions('billing.manage')
  @ApiOperation({ summary: 'Cancel a purchased add-on (at period end by default)' })
  async cancelAddon(
    @Param('organizationId') organizationId: string,
    @Param('purchaseId') purchaseId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CancelAddonDto,
  ) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.addons.cancelPurchase(
      account.id,
      purchaseId,
      organizationId,
      user.userId,
      Boolean(dto?.immediate),
    );
  }

  @Get('plan-change/:planId/preview')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Check current usage against a target plan before changing' })
  async previewPlanChange(
    @Param('organizationId') organizationId: string,
    @Param('planId') planId: string,
  ) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.limits.previewPlanChange(account.id, planId);
  }
}
