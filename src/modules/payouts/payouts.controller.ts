import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { PayoutsService } from './payouts.service';
import { CreatePayoutBatchDto, ProcessPayoutBatchDto } from './dto/payout.dto';
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
}
