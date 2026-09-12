import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/branding.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';

@ApiTags('Organization Branding')
@Controller()
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) { }

  @Get('api/v1/organizations/:organizationId/branding')
  @UseGuards(JwtAuthGuard, OrganizationGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get branding configuration for an organization' })
  async getBranding(@Param('organizationId') organizationId: string) {
    return this.brandingService.getBranding(organizationId);
  }

  @Put('api/v1/organizations/:organizationId/branding')
  @UseGuards(JwtAuthGuard, OrganizationGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update branding configuration for an organization' })
  async updateBranding(
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateBrandingDto,
  ) {
    return this.brandingService.updateBranding(organizationId, dto);
  }

  @Get('api/v1/public/organizations/:slug/branding')
  @ApiOperation({ summary: 'Get public branding configuration for a partner portal by slug' })
  async getPublicBranding(@Param('slug') slug: string) {
    return this.brandingService.getPublicBranding(slug);
  }
}

