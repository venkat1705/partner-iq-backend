import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingInterval } from '../enums/billing.enums';
import { PlanService } from '../services/plan.service';

@ApiTags('Billing Plans')
@Controller('api/v1/billing/plans')
export class PlansController {
  constructor(private readonly plans: PlanService) {}

  @Get()
  @ApiOperation({ summary: 'List public billing plans' })
  list(@Query('billingInterval') billingInterval?: BillingInterval) {
    return this.plans.listPublicPlans(billingInterval);
  }
}
