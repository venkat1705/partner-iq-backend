import { Controller, Get, Patch, Put, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { AdminService } from './admin.service';

@ApiTags('Platform Admin')
@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get real platform admin data across all organizations' })
  getOverview(@CurrentUser() user: AuthUserPayload) {
    return this.adminService.getOverview(user);
  }

  @Get('affiliates/settings')
  @ApiOperation({ summary: 'Get platform-wide affiliate eligibility settings' })
  getAffiliateSettings(@CurrentUser() user: AuthUserPayload) {
    return this.adminService.getAffiliateSettings(user);
  }

  @Patch('affiliates/settings')
  @ApiOperation({ summary: 'Update platform-wide affiliate eligibility settings' })
  updateAffiliateSettings(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: { allowOrganizationMembers: boolean },
  ) {
    return this.adminService.updateAffiliateSettings(body, user);
  }

  @Put('affiliates/settings')
  @ApiOperation({ summary: 'Update platform-wide affiliate eligibility settings (PUT)' })
  putAffiliateSettings(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: { allowOrganizationMembers: boolean },
  ) {
    return this.adminService.updateAffiliateSettings(body, user);
  }
}

