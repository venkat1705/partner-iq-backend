import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import {
  FeatureFlagsService,
  FlagsFilterQuery,
  EvaluationContext,
  CreateFlagDto,
  UpdateFlagDto,
  UpdateEnvironmentDto,
  SetRuleDto,
  SetOverrideDto,
} from './feature-flags.service';
import { EnvironmentName } from '../../../database/schema-feature-flags';

@ApiTags('Admin Feature Flags')
@ApiBearerAuth()
@Controller('api/v1')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) { }

  @Get('admin/feature-flags/overview')
  @ApiOperation({ summary: 'Get overview metrics, environment distribution, and active rollouts' })
  getOverview(@Query('environment') environment?: EnvironmentName) {
    return this.featureFlagsService.getOverview(environment || 'PRODUCTION');
  }

  @Get('admin/feature-flags')
  @ApiOperation({ summary: 'List and filter feature flags with environment statuses' })
  listFlags(@Query() query: FlagsFilterQuery) {
    return this.featureFlagsService.listFlags(query);
  }

  @Post('admin/feature-flags')
  @ApiOperation({ summary: 'Create a new feature flag across isolated environments' })
  createFlag(@Body() dto: CreateFlagDto, @Req() req: any) {
    const actor = req?.user?.email || req?.user?.id || 'admin';
    return this.featureFlagsService.createFlag(dto, actor);
  }

  @Post('admin/feature-flags/dependencies')
  @ApiOperation({ summary: 'Declare a dependency relationship between two flags' })
  addDependency(
    @Body() body: { sourceFlagKey: string; targetFlagKey: string; relationship?: 'REQUIRES_ENABLED' | 'REQUIRES_DISABLED' }
  ) {
    return this.featureFlagsService.addDependency(body.sourceFlagKey, body.targetFlagKey, body.relationship);
  }

  @Get('admin/feature-flags/lifecycle/expiring-and-stale')
  @ApiOperation({ summary: 'Detect expiring flags and stale fully-rolled-out candidates' })
  getExpiringAndStale() {
    return this.featureFlagsService.getExpiringAndStaleFlags();
  }

  @Get('admin/feature-flags/config/settings')
  @ApiOperation({ summary: 'Get global evaluation and governance settings' })
  getSettings() {
    return this.featureFlagsService.getSettings();
  }

  @Patch('admin/feature-flags/config/settings')
  @ApiOperation({ summary: 'Update global evaluation and governance settings' })
  updateSettings(@Body() updates: any) {
    return this.featureFlagsService.updateSettings(updates);
  }

  @Post('admin/feature-flags/preview-evaluate')
  @ApiOperation({ summary: 'Run evaluation engine simulation with explainability trail' })
  previewEvaluate(@Body() body: { flagKey: string; context: EvaluationContext }) {
    return this.featureFlagsService.evaluate(body.flagKey, body.context);
  }

  @Get('admin/feature-flags/:id')
  @ApiOperation({ summary: 'Get complete flag details including rules, overrides, and version history' })
  getFlagById(@Param('id') id: string) {
    return this.featureFlagsService.getFlagById(id);
  }

  @Patch('admin/feature-flags/:id')
  @ApiOperation({ summary: 'Update feature flag definition with optimistic locking' })
  updateFlag(@Param('id') id: string, @Body() dto: UpdateFlagDto, @Req() req: any) {
    const actor = req?.user?.email || req?.user?.id || 'admin';
    return this.featureFlagsService.updateFlag(id, dto, actor);
  }

  @Patch('admin/feature-flags/:id/environments/:environment')
  @ApiOperation({ summary: 'Update environment configuration, enabled state, and rollout percentage' })
  updateEnvironment(
    @Param('id') id: string,
    @Param('environment') environment: EnvironmentName,
    @Body() dto: UpdateEnvironmentDto,
    @Req() req: any
  ) {
    const actor = req?.user?.email || req?.user?.id || 'admin';
    return this.featureFlagsService.updateEnvironment(id, environment, dto, actor);
  }

  @Post('admin/feature-flags/:id/environments/:environment/rules')
  @ApiOperation({ summary: 'Create or update priority targeting rule' })
  setRule(
    @Param('id') id: string,
    @Param('environment') environment: EnvironmentName,
    @Body() dto: SetRuleDto,
    @Req() req: any
  ) {
    const actor = req?.user?.email || req?.user?.id || 'admin';
    return this.featureFlagsService.setRule(id, environment, dto, actor);
  }

  @Delete('admin/feature-flags/:id/rules/:ruleId')
  @ApiOperation({ summary: 'Delete a targeting rule' })
  deleteRule(@Param('id') id: string, @Param('ruleId') ruleId: string, @Req() req: any) {
    const actor = req?.user?.email || req?.user?.id || 'admin';
    return this.featureFlagsService.deleteRule(id, ruleId, actor);
  }

  @Post('admin/feature-flags/:id/environments/:environment/overrides')
  @ApiOperation({ summary: 'Set manual tenant override (Organization, User, or Affiliate)' })
  setOverride(
    @Param('id') id: string,
    @Param('environment') environment: EnvironmentName,
    @Body() dto: SetOverrideDto,
    @Req() req: any
  ) {
    const actor = req?.user?.email || req?.user?.id || 'admin';
    return this.featureFlagsService.setOverride(id, environment, dto, actor);
  }

  @Delete('admin/feature-flags/overrides/:overrideId')
  @ApiOperation({ summary: 'Remove a tenant override' })
  removeOverride(@Param('overrideId') overrideId: string, @Req() req: any) {
    const actor = req?.user?.email || req?.user?.id || 'admin';
    return this.featureFlagsService.removeOverride(overrideId, actor);
  }

  @Post('admin/feature-flags/:id/kill-switch')
  @ApiOperation({ summary: 'Trigger emergency kill switch with mandatory audit explanation' })
  emergencyKillSwitch(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: any
  ) {
    const actor = req?.user?.email || req?.user?.id || 'admin';
    return this.featureFlagsService.emergencyKillSwitch(id, body.reason, actor);
  }

  @Post('admin/feature-flags/:id/rollback')
  @ApiOperation({ summary: 'Rollback flag to a historical version snapshot' })
  rollback(
    @Param('id') id: string,
    @Body() body: { targetVersion: number; reason: string },
    @Req() req: any
  ) {
    const actor = req?.user?.email || req?.user?.id || 'admin';
    return this.featureFlagsService.rollbackToVersion(id, body.targetVersion, body.reason, actor);
  }

  // --------------------------------------------------------------------------
  // CLIENT EVALUATION ENDPOINTS (Frontend & SDK)
  // --------------------------------------------------------------------------
  @Post('feature-flags/batch-evaluate')
  @ApiOperation({ summary: 'Batch evaluate multiple flags for bootstrap' })
  batchEvaluate(
    @Body() body: { flagKeys: string[]; context?: EvaluationContext },
    @Req() req: any
  ) {
    const context: EvaluationContext = {
      ...body.context,
      organizationId: body.context?.organizationId || req?.user?.organizationId,
      userId: body.context?.userId || req?.user?.id,
    };
    return this.featureFlagsService.evaluateMany(body.flagKeys || [], context);
  }
}

