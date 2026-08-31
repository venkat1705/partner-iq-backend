import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AffiliatesService } from './affiliates.service';
import { AcceptAffiliateInvitationDto, CreateAffiliateDto, CreateAffiliateInvitationDto, PublicApplyDto } from './dto/affiliate.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentEnvironment } from '../../common/decorators/environment.decorator';
import { EnvironmentGuard } from '../../common/guards/environment.guard';
import { EnvironmentType } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Affiliates & Applications')
@Controller()
export class AffiliatesController {
  constructor(private readonly affiliatesService: AffiliatesService) {}

  @Post('api/v1/organizations/:organizationId/affiliates')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add affiliate directly to organization' })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateAffiliateDto,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.affiliatesService.create(organizationId, dto, user.userId, false, environment);
  }

  @Get('api/v1/organizations/:organizationId/affiliates')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all affiliates for organization' })
  async findAll(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.affiliatesService.findAll(organizationId, environment);
  }

  @Get('api/v1/organizations/:organizationId/affiliates/:affiliateId')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get specific affiliate details' })
  async findOne(
    @Param('organizationId') organizationId: string,
    @Param('affiliateId') affiliateId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.affiliatesService.findOne(organizationId, affiliateId, environment);
  }

  @Post('api/v1/organizations/:organizationId/affiliate-invitations')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invite affiliate partner to a program' })
  async inviteAffiliate(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateAffiliateInvitationDto,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.affiliatesService.inviteAffiliate(organizationId, dto, user.userId, environment);
  }

  @Get('api/v1/organizations/:organizationId/affiliate-invitations')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List affiliate invitations' })
  async listAffiliateInvitations(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.affiliatesService.listInvitations(organizationId, environment);
  }

  @Post('api/v1/organizations/:organizationId/affiliate-invitations/:invitationId/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend affiliate invitation' })
  async resendAffiliateInvitation(
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.affiliatesService.resendInvitation(organizationId, invitationId, user.userId);
  }

  @Post('api/v1/organizations/:organizationId/affiliate-invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke affiliate invitation' })
  async revokeAffiliateInvitation(
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.affiliatesService.revokeInvitation(organizationId, invitationId, user.userId);
  }

  @Get('api/v1/public/affiliate-invitations/:token')
  @ApiOperation({ summary: 'Get public affiliate invitation details' })
  async getPublicInvitation(@Param('token') token: string) {
    return this.affiliatesService.getPublicInvitation(token);
  }

  @Post('api/v1/public/affiliate-invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept affiliate invitation' })
  async acceptPublicInvitation(
    @Param('token') token: string,
    @Body() dto: AcceptAffiliateInvitationDto,
  ) {
    return this.affiliatesService.acceptAffiliateInvitation(token, dto);
  }

  @Post('api/v1/affiliate-applications/apply')
  @ApiOperation({ summary: 'Public endpoint for affiliates to apply to a program' })
  async publicApply(@Body() dto: PublicApplyDto) {
    return this.affiliatesService.submitApplication(dto);
  }

  @Get('api/v1/organizations/:organizationId/applications')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List pending affiliate applications' })
  async getApplications(@Param('organizationId') organizationId: string) {
    return this.affiliatesService.getApplications(organizationId);
  }

  @Post('api/v1/organizations/:organizationId/applications/:applicationId/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve an affiliate application' })
  async approveApplication(
    @Param('organizationId') organizationId: string,
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.affiliatesService.approveApplication(organizationId, applicationId, user.userId);
  }
}
