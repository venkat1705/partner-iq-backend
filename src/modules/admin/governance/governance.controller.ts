import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../../common/guards/platform-admin.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../../common/interfaces/request-with-user.interface';
import { PlatformGovernanceService } from './governance.service';
import {
  CreateGovernancePolicyDto,
  UpdateGovernancePolicyDto,
  CreateApprovalRequestDto,
  ReviewApprovalRequestDto,
  CreateGovernanceExceptionDto,
  ToggleEmergencyControlDto,
  ExecutePrivilegedActionDto,
  GovernanceFilterQueryDto,
} from './dto/governance.dto';

@ApiTags('Platform Governance')
@Controller('api/v1/admin/governance')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class PlatformGovernanceController {
  constructor(private readonly governanceService: PlatformGovernanceService) { }

  @Get('overview')
  @ApiOperation({ summary: 'Get evaluated platform governance status, metrics, and protection matrix' })
  getOverview() {
    return this.governanceService.getOverview();
  }

  @Get('policies')
  @ApiOperation({ summary: 'List platform governance policies with filtering' })
  listPolicies(@Query() query: GovernanceFilterQueryDto) {
    return this.governanceService.listPolicies(query);
  }

  @Get('policies/:idOrKey')
  @ApiOperation({ summary: 'Get policy details, version history, active exceptions, and violations' })
  getPolicy(@Param('idOrKey') idOrKey: string) {
    return this.governanceService.getPolicy(idOrKey);
  }

  @Post('policies')
  @ApiOperation({ summary: 'Create a new platform governance policy' })
  createPolicy(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: CreateGovernancePolicyDto,
  ) {
    return this.governanceService.createPolicy(body, user);
  }

  @Put('policies/:idOrKey')
  @ApiOperation({ summary: 'Update a platform governance policy and create version snapshot' })
  updatePolicy(
    @CurrentUser() user: AuthUserPayload,
    @Param('idOrKey') idOrKey: string,
    @Body() body: UpdateGovernancePolicyDto,
  ) {
    return this.governanceService.updatePolicy(idOrKey, body, user);
  }

  @Get('approvals')
  @ApiOperation({ summary: 'List governance approval requests' })
  listApprovals(@Query('status') status?: string) {
    return this.governanceService.listApprovals({ status });
  }

  @Post('approvals')
  @ApiOperation({ summary: 'Create a governance approval request for a sensitive action' })
  createApprovalRequest(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: CreateApprovalRequestDto,
  ) {
    return this.governanceService.createApprovalRequest(body, user);
  }

  @Post('approvals/:id/approve')
  @ApiOperation({ summary: 'Approve a governance request (enforces Four-Eyes Principle)' })
  approveRequest(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: ReviewApprovalRequestDto,
  ) {
    return this.governanceService.approveRequest(id, user, body?.reason);
  }

  @Post('approvals/:id/reject')
  @ApiOperation({ summary: 'Reject a governance approval request' })
  rejectRequest(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
    @Body() body: ReviewApprovalRequestDto,
  ) {
    return this.governanceService.rejectRequest(id, user, body?.reason);
  }

  @Get('exceptions')
  @ApiOperation({ summary: 'List active or past governance exceptions' })
  listExceptions(@Query('status') status?: string) {
    return this.governanceService.listExceptions({ status });
  }

  @Post('exceptions')
  @ApiOperation({ summary: 'Create a scoped time-bound governance exception' })
  createException(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: CreateGovernanceExceptionDto,
  ) {
    return this.governanceService.createException(body, user);
  }

  @Post('exceptions/:id/revoke')
  @ApiOperation({ summary: 'Revoke an active governance exception' })
  revokeException(
    @CurrentUser() user: AuthUserPayload,
    @Param('id') id: string,
  ) {
    return this.governanceService.revokeException(id, user);
  }

  @Get('emergency')
  @ApiOperation({ summary: 'List platform emergency controls and break-glass states' })
  getEmergencyControls() {
    return this.governanceService.getEmergencyControls();
  }

  @Post('emergency/:controlKey')
  @ApiOperation({ summary: 'Toggle an emergency control or break-glass state with mandatory reason' })
  toggleEmergencyControl(
    @CurrentUser() user: AuthUserPayload,
    @Param('controlKey') controlKey: string,
    @Body() body: ToggleEmergencyControlDto,
  ) {
    return this.governanceService.toggleEmergencyControl(controlKey, body, user);
  }

  @Get('privileged-actions')
  @ApiOperation({ summary: 'Get centralized registry of privileged administrative actions' })
  getPrivilegedActionsRegistry() {
    return this.governanceService.getPrivilegedActionsRegistry();
  }

  @Post('privileged-actions/execute')
  @ApiOperation({ summary: 'Execute or request approval for a privileged administrative action' })
  executePrivilegedAction(
    @CurrentUser() user: AuthUserPayload,
    @Body() body: ExecutePrivilegedActionDto,
  ) {
    return this.governanceService.executePrivilegedAction(body, user);
  }

  @Get('violations')
  @ApiOperation({ summary: 'List governance policy violations and blocked actions' })
  listViolations(@Query('limit') limit?: number) {
    return this.governanceService.listViolations({ limit: limit ? Number(limit) : 50 });
  }

  @Get('activity')
  @ApiOperation({ summary: 'List chronological governance audit stream' })
  listActivity(@Query('limit') limit?: number) {
    return this.governanceService.listActivity({ limit: limit ? Number(limit) : 50 });
  }
}

