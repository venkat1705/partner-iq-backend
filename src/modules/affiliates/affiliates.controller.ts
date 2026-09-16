import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AffiliatesService } from './affiliates.service';
import { AcceptAffiliateInvitationDto, BulkUploadAffiliateInvitationsDto, CreateAffiliateDto, CreateAffiliateInvitationDto, PublicApplyDto } from './dto/affiliate.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { ProgramGuard } from '../../common/guards/program.guard';
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
  constructor(private readonly affiliatesService: AffiliatesService) { }

  @Post('api/v1/organizations/:organizationId/affiliates')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, ProgramGuard, PermissionsGuard)
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
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, ProgramGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all affiliates for organization or filtered by program' })
  async findAll(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query('programId') programId?: string,
  ) {
    return this.affiliatesService.findAll(organizationId, environment, programId);
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

  @Post('api/v1/organizations/:organizationId/affiliate-invitations/bulk-upload')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk invite affiliate partners via CSV or XLSX file' })
  async bulkUploadInvitations(
    @Param('organizationId') organizationId: string,
    @Body() dto: BulkUploadAffiliateInvitationsDto,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.affiliatesService.bulkInviteAffiliates(organizationId, dto, user.userId, environment);
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

  @Get('api/v1/organizations/:organizationId/partner-suggestions')
  @UseGuards(JwtAuthGuard, OrganizationGuard, EnvironmentGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get suggested network partners for invitation' })
  async getPartnerSuggestions(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query('programId') programId?: string,
  ) {
    return this.affiliatesService.getPartnerSuggestions(organizationId, environment, programId);
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
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get public affiliate invitation details' })
  async getPublicInvitation(@Param('token') token: string) {
    return this.affiliatesService.getPublicInvitation(token);
  }

  /**
   * Records terms acceptance and returns where the partner must authenticate.
   *
   * Creates no affiliate and no membership: an invitation token proves an email
   * was invited, not that the holder owns it. Membership is created only by
   * `POST /affiliate/invitations/:token/complete`, which requires an
   * authenticated Affiliate Portal session.
   */
  @Post('api/v1/public/affiliate-invitations/:token/accept')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept invitation terms and get the Affiliate Portal next step' })
  async acceptPublicInvitationTerms(
    @Param('token') token: string,
    @Body() dto: AcceptAffiliateInvitationDto,
  ) {
    return this.affiliatesService.acceptAffiliateInvitationTerms(token, dto);
  }

  /**
   * Completes the invitation for the signed-in affiliate, creating the
   * organization/program membership. The authenticated email must match the
   * invited address.
   */
  @Post('api/v1/affiliate/invitations/:token/complete')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Join the invited program as the authenticated affiliate' })
  async completeInvitation(
    @Param('token') token: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.affiliatesService.completeAffiliateInvitation(token, user.userId);
  }

  @Post('api/v1/affiliate-applications/apply')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

  @Get('api/v1/organizations/:organizationId/applications/:applicationId')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get details of a specific affiliate application' })
  async getApplication(
    @Param('organizationId') organizationId: string,
    @Param('applicationId') applicationId: string,
  ) {
    return this.affiliatesService.getApplication(organizationId, applicationId);
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

  @Post('api/v1/organizations/:organizationId/applications/:applicationId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject an affiliate application' })
  async rejectApplication(
    @Param('organizationId') organizationId: string,
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.affiliatesService.rejectApplication(organizationId, applicationId, user.userId);
  }
}
