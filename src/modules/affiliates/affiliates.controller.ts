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
import { CreateAffiliateDto, PublicApplyDto } from './dto/affiliate.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Affiliates & Applications')
@Controller()
export class AffiliatesController {
  constructor(private readonly affiliatesService: AffiliatesService) {}

  @Post('api/v1/organizations/:organizationId/affiliates')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add affiliate directly to organization' })
  async create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateAffiliateDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.affiliatesService.create(organizationId, dto, user.userId);
  }

  @Get('api/v1/organizations/:organizationId/affiliates')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all affiliates for organization' })
  async findAll(@Param('organizationId') organizationId: string) {
    return this.affiliatesService.findAll(organizationId);
  }

  @Get('api/v1/organizations/:organizationId/affiliates/:affiliateId')
  @UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
  @RequirePermissions('manage.affiliates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get specific affiliate details' })
  async findOne(
    @Param('organizationId') organizationId: string,
    @Param('affiliateId') affiliateId: string,
  ) {
    return this.affiliatesService.findOne(organizationId, affiliateId);
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
