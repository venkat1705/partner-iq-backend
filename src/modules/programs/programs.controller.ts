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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProgramsService } from './programs.service';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';
import {
  ProgramAnalyticsQueryDto,
  BulkProgramActionDto,
  DuplicateProgramDto,
} from './dto/program-analytics.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { ProgramGuard } from '../../common/guards/program.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentEnvironment } from '../../common/decorators/environment.decorator';
import { EnvironmentType } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Partner Programs')
@Controller('api/v1/organizations/:organizationId/programs')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProgramGuard, PermissionsGuard)
@ApiBearerAuth()
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) { }

  @Post()
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Create a new partner program' })
  async create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: CreateProgramDto,
  ) {
    return this.programsService.create(organizationId, user.userId, dto, environment);
  }

  @Get()
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'List all partner programs in organization for current environment' })
  async findAll(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.programsService.findAll(organizationId, environment);
  }

  @Get('analytics/overview')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Get 360-degree program analytics, Bento KPIs, and health diagnostics' })
  async getAnalyticsOverview(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: ProgramAnalyticsQueryDto,
  ) {
    return this.programsService.getAnalyticsOverview(organizationId, environment, query);
  }

  @Get('analytics/performance')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Get per-program performance rankings and operational health' })
  async getPerformanceAnalytics(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query() query: ProgramAnalyticsQueryDto,
  ) {
    return this.programsService.getPerformanceAnalytics(organizationId, environment, query);
  }

  @Get('activity')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Get program activity and audit history' })
  async getActivityLog(
    @Param('organizationId') organizationId: string,
    @CurrentEnvironment() environment: EnvironmentType,
    @Query('programId') programId?: string,
  ) {
    return this.programsService.getActivityLog(organizationId, environment, programId);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Execute bulk status changes across partner programs' })
  async bulkAction(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: BulkProgramActionDto,
  ) {
    return this.programsService.bulkAction(organizationId, user.userId, environment, dto);
  }

  @Get(':programId')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Get specific partner program details in current environment' })
  async findOne(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.programsService.findOne(organizationId, programId, environment);
  }

  @Patch(':programId')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Update partner program configuration' })
  async update(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @Body() dto: UpdateProgramDto,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.programsService.update(organizationId, programId, dto, user.userId, environment);
  }

  @Post(':programId/copy-to-live')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Clone test program configuration to live environment' })
  async copyToLive(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() body?: { newName?: string; newSlug?: string },
  ) {
    return this.programsService.copyToLive(organizationId, programId, user.userId, body);
  }

  @Post(':programId/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Pause partner program' })
  async pause(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.programsService.pause(organizationId, programId, user.userId, environment);
  }

  @Post(':programId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Activate partner program' })
  async activate(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.programsService.activate(organizationId, programId, user.userId, environment);
  }

  @Get(':programId/analytics')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Get detailed intelligence dossier and operational analytics for a program' })
  async getProgramDetailAnalytics(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.programsService.getProgramDetailAnalytics(organizationId, programId, environment);
  }

  @Post(':programId/duplicate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Safely clone program configuration without copying analytics or affiliates' })
  async duplicateProgram(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
    @Body() dto: DuplicateProgramDto,
  ) {
    return this.programsService.duplicateProgram(organizationId, programId, user.userId, dto, environment);
  }

  @Delete(':programId')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Soft delete partner program' })
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.programsService.remove(organizationId, programId, user.userId, environment);
  }

  @Post(':programId/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Restore an archived partner program' })
  async restore(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentUser() user: AuthUserPayload,
    @CurrentEnvironment() environment: EnvironmentType,
  ) {
    return this.programsService.restore(organizationId, programId, user.userId, environment);
  }
}

