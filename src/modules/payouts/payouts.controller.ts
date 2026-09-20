import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { PayoutsService } from './payouts.service';
import {
  CreatePayoutBatchDto,
  ProcessPayoutBatchDto,
  ListPayoutsQueryDto,
  PayoutAnalyticsQueryDto,
  ValidateBatchDto,
  RetryPayoutItemDto,
  CancelBatchDto,
} from './dto/payout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentEnvironment } from '../../common/decorators/environment.decorator';
import { EnvironmentType } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Payouts & Settlements')
@Controller('api/v1/organizations/:organizationId/payouts')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) { }

  @Get('analytics')
  @RequirePermissions('view.payouts')
  @ApiOperation({ summary: 'Get payout overview metrics, trajectories, and distribution analytics' })
  async getAnalytics(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: PayoutAnalyticsQueryDto,
  ) {
    return this.payoutsService.getPayoutAnalytics(organizationId, environment, query);
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.payouts')
  @ApiOperation({ summary: 'Run pre-flight validation on affiliate balances and payment rails' })
  async validateBatch(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: ValidateBatchDto,
  ) {
    return this.payoutsService.validateBatch(organizationId, environment, dto);
  }

  @Get('reconciliation')
  @RequirePermissions('view.payouts')
  @ApiOperation({ summary: 'Get provider reconciliation matching records and discrepancies' })
  async getReconciliation(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.payoutsService.getReconciliationData(organizationId, environment);
  }

  @Get('items/paginated')
  @RequirePermissions('view.payouts')
  @ApiOperation({ summary: 'List paginated payout transactions with server-side filtering' })
  async getItemsPaginated(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: ListPayoutsQueryDto,
  ) {
    return this.payoutsService.getItemsPaginated(organizationId, environment, query);
  }

  @Get('batches/paginated')
  @RequirePermissions('view.payouts')
  @ApiOperation({ summary: 'List paginated payout batches with server-side filtering' })
  async getBatchesPaginated(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: ListPayoutsQueryDto,
  ) {
    return this.payoutsService.getBatchesPaginated(organizationId, environment, query);
  }

  @Post('items/:itemId/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.payouts')
  @ApiOperation({ summary: 'Retry a failed or held payout item' })
  async retryItem(
    @Param('organizationId') organizationId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto?: RetryPayoutItemDto,
  ) {
    return this.payoutsService.retryFailedItem(organizationId, itemId, user.userId, dto);
  }

  @Post('batches/:batchId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.payouts')
  @ApiOperation({ summary: 'Cancel a draft or held payout batch and restore affiliate balances' })
  async cancelBatch(
    @Param('organizationId') organizationId: string,
    @Param('batchId') batchId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto?: CancelBatchDto,
  ) {
    return this.payoutsService.cancelBatch(organizationId, batchId, user.userId, dto);
  }

  @Get()
  @RequirePermissions('view.payouts')
  @ApiOperation({ summary: 'List payout batches for organization in current environment' })
  async getBatches(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.payoutsService.getBatches(organizationId, environment);
  }

  @Get('items')
  @RequirePermissions('view.payouts')
  @ApiOperation({ summary: 'List all payout items for organization in current environment' })
  async getItems(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.payoutsService.getItems(organizationId, environment);
  }

  @Post('batches')
  @RequirePermissions('manage.payouts')
  @ApiOperation({ summary: 'Create a new payout batch from current affiliate balances' })
  async createBatch(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: CreatePayoutBatchDto,
  ) {
    return this.payoutsService.createBatch(organizationId, user.userId, dto, environment);
  }

  @Post('batches/:batchId/process')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.payouts')
  @ApiOperation({ summary: 'Process/complete a payout batch (simulated in test mode)' })
  async processBatch(
    @Param('organizationId') organizationId: string,
    @Param('batchId') batchId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto?: ProcessPayoutBatchDto,
  ) {
    return this.payoutsService.processBatch(organizationId, batchId, user.userId, environment, dto);
  }

  @Get('batches/:batchId/csv')
  @RequirePermissions('manage.payouts')
  @ApiOperation({ summary: 'Export payout batch as CSV' })
  async exportCsv(
    @Param('organizationId') organizationId: string,
    @Param('batchId') batchId: string,
    @Res() res: Response,
  ) {
    const csvContent = await this.payoutsService.generateCsvExport(organizationId, batchId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payout_batch_${batchId}.csv"`);
    return res.status(200).send(csvContent);
  }

  @Get('export')
  @RequirePermissions('manage.payouts')
  @ApiOperation({ summary: 'Export all organization payouts as CSV' })
  async exportAllCsv(
    @Param('organizationId') organizationId: string,
    @Res() res: Response,
  ) {
    const csvContent = await this.payoutsService.generateCsvExport(organizationId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payouts_all.csv"`);
    return res.status(200).send(csvContent);
  }
}
