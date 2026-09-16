import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { MilestoneService } from './milestone.service';
import { CreateMilestoneDto, UpdateMilestoneDto } from '../dto/milestone.dto';
import { JwtAuthGuard as AuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/organizations/:organizationId/milestones', 'organizations/:organizationId/milestones'])
@UseGuards(AuthGuard, OrganizationGuard, RbacGuard)
export class MilestoneController {
  constructor(private readonly milestoneService: MilestoneService) {}

  @Get()
  @RequirePermission('milestones.view')
  async getMilestones(@Param('organizationId') orgId: string, @Query('programId') programId?: string) {
    return this.milestoneService.getMilestones(orgId, programId);
  }

  @Post()
  @RequirePermission('milestones.create')
  async createMilestone(@Req() req: any, @Param('organizationId') orgId: string, @Body() dto: CreateMilestoneDto) {
    return this.milestoneService.createMilestone(orgId, dto, req.user.id);
  }

  @Get(':id')
  @RequirePermission('milestones.view')
  async getMilestone(@Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.milestoneService.getMilestone(orgId, id);
  }

  @Patch(':id')
  @RequirePermission('milestones.edit')
  async updateMilestone(
    @Req() req: any,
    @Param('organizationId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.milestoneService.updateMilestone(orgId, id, dto, req.user.id);
  }

  @Delete(':id')
  @RequirePermission('milestones.delete')
  async deleteMilestone(@Req() req: any, @Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.milestoneService.deleteMilestone(orgId, id, req.user.id);
  }

  @Get(':id/achievements')
  @RequirePermission('milestones.view')
  async getAchievements(@Param('organizationId') orgId: string, @Param('id') id: string) {
    return this.milestoneService.getMilestoneAchievements(orgId, id);
  }
}
