import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookEndpointDto } from './dto/webhook.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Webhooks Engine')
@Controller('api/v1/organizations/:organizationId/webhooks')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @RequirePermissions('manage.webhooks')
  @ApiOperation({ summary: 'Register a new webhook endpoint' })
  async createEndpoint(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateWebhookEndpointDto,
  ) {
    return this.webhooksService.createEndpoint(organizationId, user.userId, dto);
  }

  @Get()
  @RequirePermissions('manage.webhooks')
  @ApiOperation({ summary: 'List webhook endpoints' })
  async getEndpoints(@Param('organizationId') organizationId: string) {
    return this.webhooksService.getEndpoints(organizationId);
  }

  @Get('deliveries')
  @RequirePermissions('manage.webhooks')
  @ApiOperation({ summary: 'List webhook delivery logs' })
  async getDeliveries(@Param('organizationId') organizationId: string) {
    return this.webhooksService.getDeliveries(organizationId);
  }
}
