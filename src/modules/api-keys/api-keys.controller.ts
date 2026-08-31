import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentEnvironment } from '../../common/decorators/environment.decorator';
import { EnvironmentGuard } from '../../common/guards/environment.guard';
import { EnvironmentType } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('API Keys')
@Controller('api/v1/organizations/:organizationId/api-keys')
@UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
@ApiBearerAuth()
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @RequirePermissions('manage.api_keys')
  @ApiOperation({ summary: 'Create a new server-to-server API key' })
  async create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(organizationId, user.userId, dto, environment);
  }

  @Get()
  @RequirePermissions('manage.api_keys')
  @ApiOperation({ summary: 'List all API keys for organization' })
  async findAll(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.apiKeysService.findAll(organizationId, environment);
  }

  @Delete(':apiKeyId')
  @RequirePermissions('manage.api_keys')
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(
    @Param('organizationId') organizationId: string,
    @Param('apiKeyId') apiKeyId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.apiKeysService.revoke(organizationId, apiKeyId, user.userId, environment);
  }
}
