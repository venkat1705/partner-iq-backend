import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { ConversionsService } from './conversions.service';
import { CreateConversionDto, RefundConversionDto } from './dto/conversion.dto';
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
import { Query } from '@nestjs/common';

@ApiTags('Conversions & Idempotency')
@Controller()
export class ConversionsController {
  constructor(private readonly conversionsService: ConversionsService) { }

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

  @Get('api/v1/organizations/:organizationId/conversions')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, ProgramGuard, PermissionsGuard)
  @RequirePermissions('view.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List conversions for organization or filtered by program' })
  async findAll(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query('programId') programId?: string,
  ) {
    return this.conversionsService.findAll(organizationId, environment, programId);
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
}
