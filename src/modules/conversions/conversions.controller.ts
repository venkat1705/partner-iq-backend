import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import type { Response } from 'express';
import { ConversionsService } from './conversions.service';
import {
  CreateConversionDto,
  RefundConversionDto,
  ListConversionsQueryDto,
  ConversionAnalyticsQueryDto,
  ApproveConversionDto,
  RejectConversionDto,
  BulkApproveConversionsDto,
  CreateManualConversionDto,
} from './dto/conversion.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { ProgramGuard } from '../../common/guards/program.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentEnvironment } from '../../common/decorators/environment.decorator';
import { EnvironmentGuard } from '../../common/guards/environment.guard';
import { EnvironmentType } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { RequireApiScopes } from '../../common/decorators/require-api-scopes.decorator';

@ApiTags('Conversions & Attribution Intelligence')
@Controller()
export class ConversionsController {
  constructor(private readonly conversionsService: ConversionsService) { }

  // ---------------------------------------------------------------------------
  // PUBLIC SERVER-TO-SERVER (API KEY) ENDPOINTS
  // ---------------------------------------------------------------------------

  @Post('api/v1/conversions')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('conversions:write')
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Unique key to guarantee single execution' })
  @ApiOperation({ summary: 'Create a conversion event (Server-to-Server API Key required)' })
  async createConversion(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateConversionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.conversionsService.createConversion(user.organizationId!, dto, idempotencyKey, {
      apiKeyId: user.apiKeyId,
      environment: user.apiKeyEnvironment,
    });
  }

  @Get('api/v1/conversions/:id')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('conversions:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a conversion by PartnerIQ id or externalId' })
  async getPublicConversion(@Param('id') conversionId: string, @CurrentUser() user: AuthUserPayload) {
    return this.conversionsService.findOne(user.organizationId!, conversionId, user.apiKeyEnvironment as EnvironmentType);
  }

  @Post('api/v1/conversions/:id/refund')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('refunds:write')
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Unique key to guarantee a retried refund is applied only once' })
  @ApiOperation({ summary: 'Process a full or partial conversion refund and proportionally clawback commission' })
  async refundConversion(
    @Param('id') conversionId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: RefundConversionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.conversionsService.refundConversion(user.organizationId!, conversionId, dto, user.apiKeyEnvironment as EnvironmentType, {
      apiKeyId: user.apiKeyId,
      idempotencyKey,
    });
  }

  // ---------------------------------------------------------------------------
  // ENTERPRISE MANAGEMENT & INTELLIGENCE ENDPOINTS (JWT AUTH)
  // ---------------------------------------------------------------------------

  @Get('api/v1/organizations/:organizationId/conversions/analytics')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('view.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get 360-degree conversion analytics, trajectory, and operational metrics' })
  async getAnalytics(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: ConversionAnalyticsQueryDto,
  ) {
    return this.conversionsService.getConversionAnalytics(organizationId, environment, query);
  }

  @Get('api/v1/organizations/:organizationId/conversions/paginated')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('view.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List conversions with server-side pagination, sorting, search, and filtering' })
  async getConversionsPaginated(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: ListConversionsQueryDto,
  ) {
    return this.conversionsService.getConversionsPaginated(organizationId, environment, query);
  }

  @Get('api/v1/organizations/:organizationId/conversions/export')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('view.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export filtered conversions as CSV' })
  async exportCsv(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: ListConversionsQueryDto,
    @Res() res: Response,
  ) {
    const csvContent = await this.conversionsService.generateCsvExport(organizationId, environment, query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="conversions_export_${Date.now()}.csv"`);
    return res.status(200).send(csvContent);
  }

  @Get('api/v1/organizations/:organizationId/conversions/:id/detail')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('view.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get comprehensive 360 conversion dossier including attribution, checks, and audit' })
  async getDetail(
    @Param('organizationId') organizationId: string,
    @Param('id') conversionId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.conversionsService.getConversionDetail(organizationId, conversionId, environment);
  }

  @Post('api/v1/organizations/:organizationId/conversions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a pending conversion and trigger commission' })
  async approveConversion(
    @Param('organizationId') organizationId: string,
    @Param('id') conversionId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ApproveConversionDto,
  ) {
    return this.conversionsService.approveConversion(organizationId, conversionId, user.userId || 'admin', dto);
  }

  @Post('api/v1/organizations/:organizationId/conversions/:id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a conversion with operational reason and reverse commission' })
  async rejectConversion(
    @Param('organizationId') organizationId: string,
    @Param('id') conversionId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: RejectConversionDto,
  ) {
    return this.conversionsService.rejectConversion(organizationId, conversionId, user.userId || 'admin', dto);
  }

  @Post('api/v1/organizations/:organizationId/conversions/:id/refund')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Process conversion refund from dashboard with ledger clawback' })
  async refundFromDashboard(
    @Param('organizationId') organizationId: string,
    @Param('id') conversionId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: RefundConversionDto,
  ) {
    return this.conversionsService.refundConversion(organizationId, conversionId, dto, environment);
  }

  @Post('api/v1/organizations/:organizationId/conversions/bulk-approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk approve pending conversions' })
  async bulkApprove(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: BulkApproveConversionsDto,
  ) {
    return this.conversionsService.bulkApproveConversions(organizationId, user.userId || 'admin', dto);
  }

  @Post('api/v1/organizations/:organizationId/conversions/manual')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record manual offline or B2B conversion' })
  async createManualConversion(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: CreateManualConversionDto,
  ) {
    return this.conversionsService.createManualConversion(organizationId, user.userId || 'admin', dto, environment);
  }

  @Get('api/v1/organizations/:organizationId/conversions')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, ProgramGuard, PermissionsGuard)
  @RequirePermissions('view.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List conversions for organization or filtered by program (Legacy)' })
  async findAll(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query('programId') programId?: string,
  ) {
    return this.conversionsService.findAll(organizationId, environment, programId);
  }
}
