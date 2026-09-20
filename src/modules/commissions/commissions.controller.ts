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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommissionsService } from './commissions.service';
import {
  CreateCommissionRuleDto,
  TestCommissionRulesDto,
  UpdateCommissionRuleDto,
  ListCommissionsQueryDto,
  CommissionAnalyticsQueryDto,
  AdjustCommissionDto,
  ApproveCommissionDto,
  BulkApproveCommissionsDto,
  RejectCommissionDto,
  ResolveDisputeDto,
} from './dto/commission.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { ProgramGuard } from '../../common/guards/program.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import type { Response } from 'express';
import { Res } from '@nestjs/common';

@ApiTags('Commissions Engine')
@Controller('api/v1/organizations/:organizationId/commissions')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProgramGuard, PermissionsGuard)
@ApiBearerAuth()
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) { }

  @Get()
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'List commissions with enterprise server-side filtering and pagination' })
  async getCommissions(
    @Param('organizationId') organizationId: string,
    @Query() query: ListCommissionsQueryDto,
  ) {
    return this.commissionsService.getCommissionsPaginated(organizationId, query);
  }

  @Get('analytics')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'Commission analytics, time-series, and executive bento metrics' })
  async getAnalytics(
    @Param('organizationId') organizationId: string,
    @Query() query: CommissionAnalyticsQueryDto,
  ) {
    return this.commissionsService.getCommissionAnalytics(organizationId, query);
  }

  @Get('payout-readiness')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'Commission payout readiness breakdown and eligible balances' })
  async getPayoutReadiness(
    @Param('organizationId') organizationId: string,
    @Query() query?: any,
  ) {
    return this.commissionsService.getPayoutReadiness(organizationId, query);
  }

  @Get('disputes')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'List disputed and flagged commissions' })
  async getDisputes(@Param('organizationId') organizationId: string) {
    return this.commissionsService.getDisputes(organizationId);
  }

  @Get('audit')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'Audit logs for commission actions and adjustments' })
  async getAudit(
    @Param('organizationId') organizationId: string,
    @Query('commissionId') commissionId?: string,
  ) {
    return this.commissionsService.getCommissionAuditLogs(organizationId, commissionId);
  }

  @Get('export')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'Export filtered commissions as CSV' })
  async exportCsv(
    @Param('organizationId') organizationId: string,
    @Query() query: ListCommissionsQueryDto,
    @Res() res: Response,
  ) {
    const csvContent = await this.commissionsService.exportCommissions(organizationId, query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="commissions-export.csv"');
    return res.status(200).send(csvContent);
  }

  @Post('bulk-approve')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Bulk approve pending commissions' })
  async bulkApprove(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: BulkApproveCommissionsDto,
  ) {
    return this.commissionsService.bulkApproveCommissions(organizationId, dto.commissionIds, user.userId, dto.notes);
  }

  @Get(':id')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'Get single commission details with attribution and ledger records' })
  async getCommission(
    @Param('organizationId') organizationId: string,
    @Param('id') commissionId: string,
  ) {
    return this.commissionsService.getCommissionById(organizationId, commissionId);
  }

  @Post(':id/approve')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Approve a single pending commission' })
  async approveCommission(
    @Param('organizationId') organizationId: string,
    @Param('id') commissionId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ApproveCommissionDto,
  ) {
    return this.commissionsService.approveCommission(organizationId, commissionId, user.userId, dto.notes);
  }

  @Post(':id/reject')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Reject a pending commission' })
  async rejectCommission(
    @Param('organizationId') organizationId: string,
    @Param('id') commissionId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: RejectCommissionDto,
  ) {
    return this.commissionsService.rejectCommission(organizationId, commissionId, dto.reason, user.userId, dto.notes);
  }

  @Post(':id/adjust')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Manually adjust a commission with audit trail' })
  async adjustCommission(
    @Param('organizationId') organizationId: string,
    @Param('id') commissionId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: AdjustCommissionDto,
  ) {
    return this.commissionsService.adjustCommission(organizationId, commissionId, dto, user.userId);
  }

  @Post(':id/dispute')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Resolve a commission dispute' })
  async resolveDispute(
    @Param('organizationId') organizationId: string,
    @Param('id') commissionId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.commissionsService.resolveDispute(organizationId, commissionId, dto, user.userId);
  }

  @Post('rules')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Create a data-driven commission rule' })
  async createRule(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateCommissionRuleDto,
  ) {
    return this.commissionsService.createRule(organizationId, dto);
  }

  @Get('rules')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'List commission rules' })
  async getRules(@Param('organizationId') organizationId: string) {
    return this.commissionsService.getRules(organizationId);
  }

  @Get('programs/:programId/rules')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'List commission rules for a program' })
  async getProgramRules(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
  ) {
    return this.commissionsService.getRules(organizationId, programId);
  }

  @Post('programs/:programId/rules')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Create program-scoped commission rule' })
  async createProgramRule(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @Body() dto: CreateCommissionRuleDto,
  ) {
    return this.commissionsService.createRule(organizationId, { ...dto, programId });
  }

  @Post('programs/:programId/rules/test')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'Test program-scoped commission rules' })
  async testProgramRules(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @Body() dto: TestCommissionRulesDto,
  ) {
    return this.commissionsService.testRules(organizationId, programId, dto);
  }

  @Patch('rules/:ruleId')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Update a commission rule (creates a new version)' })
  async updateRule(
    @Param('organizationId') organizationId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateCommissionRuleDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.commissionsService.updateRule(organizationId, ruleId, dto, user.userId);
  }

  @Get('rules/:ruleId/history')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'View a commission rule\'s version history' })
  async getRuleHistory(
    @Param('organizationId') organizationId: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.commissionsService.getRuleHistory(organizationId, ruleId);
  }

  @Delete('rules/:ruleId')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Delete a commission rule' })
  async deleteRule(
    @Param('organizationId') organizationId: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.commissionsService.deleteRule(organizationId, ruleId);
  }
}
