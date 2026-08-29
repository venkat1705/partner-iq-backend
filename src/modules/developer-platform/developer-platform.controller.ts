import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequireApiScopes } from '../../common/decorators/require-api-scopes.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { CreateTrackingLinkDto } from '../tracking/dto/tracking.dto';
import { TrackingService } from '../tracking/tracking.service';
import { CreateWebhookEndpointDto } from '../webhooks/dto/webhook.dto';
import { WebhooksService } from '../webhooks/webhooks.service';
import { DeveloperPlatformService } from './developer-platform.service';
import {
  AttachOrderDto,
  BrowserReferralDto,
  CreatePublicBrowserKeyDto,
  PublicIdentifyCustomerDto,
} from './dto/developer-platform.dto';

@ApiTags('Public REST API v1')
@ApiBearerAuth()
@Controller('api/v1')
export class DeveloperPlatformController {
  constructor(
    private readonly developerPlatformService: DeveloperPlatformService,
    private readonly trackingService: TrackingService,
    private readonly webhooksService: WebhooksService,
  ) {}

  @Get('programs')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('programs:read')
  @ApiOperation({ summary: 'List programs visible to this API key organization' })
  listPrograms(@CurrentUser() user: AuthUserPayload) {
    return this.developerPlatformService.listPrograms(user.organizationId!, user.apiKeyEnvironment || 'live');
  }

  @Get('affiliates/:id')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('affiliates:read')
  @ApiOperation({ summary: 'Get affiliate details by id' })
  getAffiliate(@CurrentUser() user: AuthUserPayload, @Param('id') affiliateId: string) {
    return this.developerPlatformService.getAffiliate(user.organizationId!, affiliateId);
  }

  @Post('customers/identify')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('customers:write')
  @ApiOperation({ summary: 'Attach a customer external id to existing attribution records' })
  identifyCustomer(@CurrentUser() user: AuthUserPayload, @Body() dto: PublicIdentifyCustomerDto) {
    return this.developerPlatformService.identifyCustomer(user.organizationId!, dto);
  }

  @Post('attributions/attach-order')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('attributions:write')
  @ApiOperation({ summary: 'Attach a payment-provider order to an attribution' })
  attachOrder(@CurrentUser() user: AuthUserPayload, @Body() dto: AttachOrderDto) {
    return this.developerPlatformService.attachOrder(user.organizationId!, dto);
  }

  @Post('tracking-links')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('tracking_links:write')
  @ApiOperation({ summary: 'Create a tracking link using a secret API key' })
  createTrackingLink(@CurrentUser() user: AuthUserPayload, @Body() dto: CreateTrackingLinkDto) {
    return this.trackingService.createLink(user.organizationId!, dto, user.userId);
  }

  @Post('webhook-endpoints')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('webhooks:write')
  @ApiOperation({ summary: 'Create an outgoing webhook endpoint using a secret API key' })
  createWebhookEndpoint(@CurrentUser() user: AuthUserPayload, @Body() dto: CreateWebhookEndpointDto) {
    return this.webhooksService.createEndpoint(user.organizationId!, user.userId, dto);
  }

  @Get('webhook-endpoints')
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('webhooks:read')
  @ApiOperation({ summary: 'List outgoing webhook endpoints using a secret API key' })
  listWebhookEndpoints(@CurrentUser() user: AuthUserPayload) {
    return this.webhooksService.getEndpoints(user.organizationId!);
  }

  @Post('organizations/:organizationId/public-browser-keys')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.api_keys')
  @ApiOperation({ summary: 'Create a public browser key and allowed-domain policy' })
  createPublicBrowserKey(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreatePublicBrowserKeyDto,
  ) {
    return this.developerPlatformService.createPublicBrowserKey(organizationId, user.userId, dto);
  }

  @Get('organizations/:organizationId/public-browser-keys')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.api_keys')
  @ApiOperation({ summary: 'List public browser keys' })
  listPublicBrowserKeys(@Param('organizationId') organizationId: string) {
    return this.developerPlatformService.listPublicBrowserKeys(organizationId);
  }

  @Post('browser/referrals')
  @ApiOperation({ summary: 'Browser SDK referral tracking endpoint guarded by public key and allowed domains' })
  browserReferral(
    @Body() dto: BrowserReferralDto,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.developerPlatformService.trackBrowserReferral(dto, origin, referer);
  }
}
