import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { CancelSubscriptionDto, ChangeSubscriptionDto } from '../dto/billing.dto';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionLimitService } from '../services/subscription-limit.service';
import { BillingAccountService } from '../services/billing-account.service';

@ApiTags('Billing Subscriptions')
@Controller('api/v1/organizations/:organizationId/billing/subscription')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly limits: SubscriptionLimitService,
    private readonly accounts: BillingAccountService,
  ) {}

  @Post('upgrade')
  @RequirePermissions('billing.manage')
  @ApiOperation({ summary: 'Upgrade organization subscription immediately' })
  upgrade(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ChangeSubscriptionDto,
  ) {
    return this.subscriptions.upgrade(organizationId, user.userId, dto.planId, dto.billingInterval);
  }

  @Post('downgrade')
  @RequirePermissions('billing.manage')
  @ApiOperation({ summary: 'Schedule organization subscription downgrade at period end' })
  downgrade(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ChangeSubscriptionDto,
  ) {
    return this.subscriptions.downgrade(organizationId, user.userId, dto.planId, dto.billingInterval);
  }

  @Post('cancel')
  @RequirePermissions('billing.cancel')
  @ApiOperation({ summary: 'Cancel organization subscription' })
  cancel(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptions.cancel(organizationId, user.userId, Boolean(dto.immediate));
  }

  @Post('resume')
  @RequirePermissions('billing.manage')
  resume() {
    return { resumed: true };
  }

  /**
   * Dry run of a plan change. Returns which resources current usage would put
   * over the target plan, so the customer sees it before anything changes.
   */
  @Post('preview')
  @RequirePermissions('billing.view')
  @ApiOperation({ summary: 'Check current usage against a target plan' })
  async preview(
    @Param('organizationId') organizationId: string,
    @Body() dto: ChangeSubscriptionDto,
  ) {
    const account = await this.accounts.resolveForOrganization(organizationId);
    return this.limits.previewPlanChange(account.id, dto.planId);
  }
}
