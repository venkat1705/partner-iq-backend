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
    @Body() dto: CreateProgramDto,
  ) {
    return this.programsService.create(organizationId, user.userId, dto);
  }

  @Get()
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'List all partner programs in organization' })
  async findAll(@Param('organizationId') organizationId: string) {
    return this.programsService.findAll(organizationId);
  }

  @Get(':programId')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Get specific partner program details' })
  async findOne(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
  ) {
    return this.programsService.findOne(organizationId, programId);
  }

  @Patch(':programId')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Update partner program configuration' })
  async update(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @Body() dto: UpdateProgramDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.programsService.update(organizationId, programId, dto, user.userId);
  }

  @Post(':programId/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Pause partner program' })
  async pause(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.programsService.pause(organizationId, programId, user.userId);
  }

  @Post(':programId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Activate partner program' })
  async activate(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.programsService.activate(organizationId, programId, user.userId);
  }

  @Delete(':programId')
  @RequirePermissions('manage.programs')
  @ApiOperation({ summary: 'Soft delete partner program' })
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.programsService.remove(organizationId, programId, user.userId);
  }
}
