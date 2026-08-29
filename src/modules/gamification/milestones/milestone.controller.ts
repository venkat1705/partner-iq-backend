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
import { PermissionsGuard as RbacGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions as RequirePermission } from '../../../common/decorators/require-permissions.decorator';

@Controller(['api/v1/milestones', 'milestones'])
@UseGuards(AuthGuard, RbacGuard)
export class MilestoneController {
  constructor(private readonly milestoneService: MilestoneService) {}

  @Get()
  @RequirePermission('milestones.view')
  async getMilestones(@Req() req: any, @Query('programId') programId?: string) {
    const orgId = req.user.organizationId;
    return this.milestoneService.getMilestones(orgId, programId);
  }

  @Post()
  @RequirePermission('milestones.create')
  async createMilestone(@Req() req: any, @Body() dto: CreateMilestoneDto) {
    const orgId = req.user.organizationId;
    return this.milestoneService.createMilestone(orgId, dto, req.user.id);
  }

  @Get(':id')
  @RequirePermission('milestones.view')
  async getMilestone(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.milestoneService.getMilestone(orgId, id);
  }

  @Patch(':id')
  @RequirePermission('milestones.edit')
  async updateMilestone(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    const orgId = req.user.organizationId;
    return this.milestoneService.updateMilestone(orgId, id, dto, req.user.id);
  }

  @Delete(':id')
  @RequirePermission('milestones.delete')
  async deleteMilestone(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.milestoneService.deleteMilestone(orgId, id, req.user.id);
  }

  @Get(':id/achievements')
  @RequirePermission('milestones.view')
  async getAchievements(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return this.milestoneService.getMilestoneAchievements(orgId, id);
  }
}
