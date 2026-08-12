import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { CreatePlanDto, RefundDto } from '../dto/billing.dto';
import { PlanService } from '../services/plan.service';
import { AdminBillingService } from '../services/admin-billing.service';
import { PaymentService } from '../services/payment.service';

@ApiTags('Admin Billing')
@Controller('api/v1/admin/billing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminBillingController {
  constructor(
    private readonly adminBilling: AdminBillingService,
    private readonly plans: PlanService,
    private readonly payments: PaymentService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get platform billing analytics' })
  overview() {
    return this.adminBilling.overview();
  }

  @Post('plans')
  @RequirePermissions('billing.admin')
  createPlan(@CurrentUser() user: AuthUserPayload, @Body() dto: CreatePlanDto) {
    return this.plans.createPlan(dto, user.userId);
  }

  @Get('subscriptions')
  subscriptions() {
    return this.adminBilling.subscriptions();
  }

  @Get('payments')
  paymentsList() {
    return this.adminBilling.payments();
  }

  @Post('refunds')
  @RequirePermissions('billing.refund')
  refund(@CurrentUser() user: AuthUserPayload, @Body() dto: RefundDto) {
    return this.payments.refund(user.organizationId || '', user.userId, dto.paymentId, dto.amount);
  }
}
