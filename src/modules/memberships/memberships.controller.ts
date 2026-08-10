import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MembershipsService } from './memberships.service';
import { InviteMemberDto, UpdateMemberRoleDto } from './dto/membership.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Organization Memberships')
@Controller('api/v1/organizations/:organizationId/members')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  @RequirePermissions('view.organization')
  @ApiOperation({ summary: 'List all organization members' })
  async getMembers(@Param('organizationId') organizationId: string) {
    return this.membershipsService.getMembers(organizationId);
  }

  @Post()
  @RequirePermissions('manage.organization')
  @ApiOperation({ summary: 'Invite new member to organization' })
  async inviteMember(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: InviteMemberDto,
  ) {
    return this.membershipsService.inviteMember(organizationId, user.userId, dto);
  }

  @Patch(':memberId')
  @RequirePermissions('manage.organization')
  @ApiOperation({ summary: 'Update member role' })
  async updateMemberRole(
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.membershipsService.updateMemberRole(organizationId, memberId, dto, user.userId);
  }

  @Delete(':memberId')
  @RequirePermissions('manage.organization')
  @ApiOperation({ summary: 'Remove member from organization' })
  async removeMember(
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.membershipsService.removeMember(organizationId, memberId, user.userId);
  }
}
