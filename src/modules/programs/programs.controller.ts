import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProgramsService } from './programs.service';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentEnvironment } from '../../common/decorators/environment.decorator';
import { EnvironmentType } from '../../common/enums';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Partner Programs')
@Controller('api/v1/organizations/:organizationId/programs')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class ProgramsController {
  constructor(private readonly programsService: ProgramsService) {}

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
}

