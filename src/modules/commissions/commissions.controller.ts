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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommissionsService } from './commissions.service';
import { CreateCommissionRuleDto, TestCommissionRulesDto, UpdateCommissionRuleDto } from './dto/commission.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { ProgramGuard } from '../../common/guards/program.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Commissions Engine')
@Controller('api/v1/organizations/:organizationId/commissions')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProgramGuard, PermissionsGuard)
@ApiBearerAuth()
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) { }

  @Get()
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'List all commissions in organization or filtered by program' })
  async getCommissions(
    @Param('organizationId') organizationId: string,
    @Query('programId') programId?: string,
  ) {
    return this.commissionsService.getCommissions(organizationId, programId);
  }

  @Post('rules')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Create a data-driven commission rule' })
  async createRule(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateCommissionRuleDto,
  ) {
    return this.commissionsService.createRule(organizationId, dto);
  }

  @Get('rules')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'List commission rules' })
  async getRules(@Param('organizationId') organizationId: string) {
    return this.commissionsService.getRules(organizationId);
  }

  @Get('programs/:programId/rules')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'List commission rules for a program' })
  async getProgramRules(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
  ) {
    return this.commissionsService.getRules(organizationId, programId);
  }

  @Post('programs/:programId/rules')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Create program-scoped commission rule' })
  async createProgramRule(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @Body() dto: CreateCommissionRuleDto,
  ) {
    return this.commissionsService.createRule(organizationId, { ...dto, programId });
  }

  @Post('programs/:programId/rules/test')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'Test program-scoped commission rules' })
  async testProgramRules(
    @Param('organizationId') organizationId: string,
    @Param('programId') programId: string,
    @Body() dto: TestCommissionRulesDto,
  ) {
    return this.commissionsService.testRules(organizationId, programId, dto);
  }

  @Patch('rules/:ruleId')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Update a commission rule (creates a new version)' })
  async updateRule(
    @Param('organizationId') organizationId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateCommissionRuleDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.commissionsService.updateRule(organizationId, ruleId, dto, user.userId);
  }

  @Get('rules/:ruleId/history')
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'View a commission rule\'s version history' })
  async getRuleHistory(
    @Param('organizationId') organizationId: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.commissionsService.getRuleHistory(organizationId, ruleId);
  }

  @Delete('rules/:ruleId')
  @RequirePermissions('manage.commissions')
  @ApiOperation({ summary: 'Delete a commission rule' })
  async deleteRule(
    @Param('organizationId') organizationId: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.commissionsService.deleteRule(organizationId, ruleId);
  }
}
