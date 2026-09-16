import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingInterval } from '../enums/billing.enums';
import { PlanService } from '../services/plan.service';
import { AddonService } from '../services/addon.service';
import { BillingTaxService } from '../services/billing-tax.service';

/**
 * Public plan catalog powering the pricing page.
 *
 * Unauthenticated on purpose — anyone can see what PartnerIQ costs — and
 * database-driven, so the marketing page never carries its own copy of a price
 * or an allowance.
 */
@ApiTags('Billing Plans')
@Controller('api/v1/billing/plans')
export class PlansController {
  constructor(
    private readonly plans: PlanService,
    private readonly addons: AddonService,
    private readonly tax: BillingTaxService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List public billing plans with their included limits' })
  list(@Query('billingInterval') billingInterval?: BillingInterval) {
    return this.plans.listPublicPlans(billingInterval);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Plans, add-ons and tax for both billing intervals in one call' })
  async catalog() {
    const [monthly, yearly, monthlyAddons, yearlyAddons] = await Promise.all([
      this.plans.listPublicPlans(BillingInterval.MONTHLY),
      this.plans.listPublicPlans(BillingInterval.YEARLY),
      this.addons.listAddons(BillingInterval.MONTHLY),
      this.addons.listAddons(BillingInterval.YEARLY),
    ]);

    return {
      currency: monthly[0]?.currency || 'INR',
      plans: { MONTHLY: monthly, YEARLY: yearly },
      addons: { MONTHLY: monthlyAddons, YEARLY: yearlyAddons },
      tax: this.tax.getConfig(),
    };
  }
}
