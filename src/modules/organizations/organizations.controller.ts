import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OnboardingOrgDto,
  OnboardingProgramDto,
} from './dto/organization.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Organizations & Onboarding')
@Controller()
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  @Post('api/v1/organizations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new organization' })
  async create(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.orgsService.create(user.userId, dto);
  }

  @Get('api/v1/organizations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all organizations for authenticated user' })
  async findAllForUser(@CurrentUser() user: AuthUserPayload) {
    return this.orgsService.findAllForUser(user.userId, user.isSuperAdmin);
  }

  @Get('api/v1/organizations/:organizationId')
  @UseGuards(JwtAuthGuard, OrganizationGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get details for a specific organization' })
  async findOne(@Param('organizationId') organizationId: string) {
    return this.orgsService.findOne(organizationId);
  }

  @Patch('api/v1/organizations/:organizationId')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.organization')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update organization settings' })
  async update(
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.orgsService.update(organizationId, dto);
  }

  // --- Onboarding Endpoints ---
  @Post('api/v1/onboarding/organization')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Onboarding Step 1: Create Organization' })
  async onboardingOrg(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: OnboardingOrgDto,
  ) {
    return this.orgsService.onboardingOrg(user.userId, dto);
  }

  @Post('api/v1/onboarding/program')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.organization')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Onboarding Step: Create Initial Partner Program' })
  async onboardingProgram(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: OnboardingProgramDto,
  ) {
    return this.orgsService.onboardingProgram(user.userId, dto);
  }

  @Post('api/v1/onboarding/complete')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.organization')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Onboarding Step: Complete Onboarding' })
  async completeOnboarding(@Body('organizationId') organizationId: string) {
    return this.orgsService.completeOnboarding(organizationId);
  }
}
