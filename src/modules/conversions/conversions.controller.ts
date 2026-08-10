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
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Conversions & Idempotency')
@Controller()
export class ConversionsController {
  constructor(private readonly conversionsService: ConversionsService) {}

  @Post('api/v1/conversions')
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Unique key to guarantee single execution' })
  @ApiOperation({ summary: 'Create a conversion event (Server-to-Server API Key required)' })
  async createConversion(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateConversionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.conversionsService.createConversion(user.organizationId!, dto, idempotencyKey);
  }

  @Get('api/v1/organizations/:organizationId/conversions')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('view.conversions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List conversions for organization' })
  async findAll(@Param('organizationId') organizationId: string) {
    return this.conversionsService.findAll(organizationId);
  }

  @Post('api/v1/conversions/:id/refund')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.commissions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Process a conversion refund and clawback commission' })
  async refundConversion(
    @Param('id') conversionId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: RefundConversionDto,
  ) {
    return this.conversionsService.refundConversion(user.organizationId!, conversionId, dto);
  }
}
