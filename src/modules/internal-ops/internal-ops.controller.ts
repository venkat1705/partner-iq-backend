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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { InternalOpsGuard } from './internal-ops.guard';
import { InternalOpsService } from './internal-ops.service';
import {
  CreateSuperAdminDto,
  UpdateSuperAdminDto,
  TriggerTestEmailDto,
  GenerateTestDocumentDto,
  SeedSandboxOrgDto,
} from './dto/internal-ops.dto';

@ApiTags('Internal Ops & Private Superadmin Management')
@Controller('api/v1/internal')
@UseGuards(InternalOpsGuard)
@ApiHeader({
  name: 'x-internal-secret',
  description: 'Private internal secret key (INTERNAL_OPS_KEY)',
  required: false,
})
@ApiBearerAuth()
export class InternalOpsController {
  constructor(private readonly internalOpsService: InternalOpsService) { }

  // ─────────────────────────────────────────────────────────
  // SUPERADMIN PROVISIONING & DIRECTORY
  // ─────────────────────────────────────────────────────────

  @Post('superadmins')
  @ApiOperation({
    summary: 'Provision or upgrade a superadmin account',
    description:
      'Creates a new SuperAdmin account or upgrades an existing user to SUPER_ADMIN role with full platform privileges, hashed password, and verified email.',
  })
  @ApiResponse({ status: 201, description: 'SuperAdmin created or upgraded successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Missing or invalid internal secret' })
  provisionSuperAdmin(@Body() dto: CreateSuperAdminDto) {
    return this.internalOpsService.provisionSuperAdmin(dto);
  }

  @Get('superadmins')
  @ApiOperation({
    summary: 'List all superadmin accounts',
    description: 'Retrieves all users currently assigned the SUPER_ADMIN platform role.',
  })
  listSuperAdmins() {
    return this.internalOpsService.listSuperAdmins();
  }

  @Get('superadmins/:id')
  @ApiOperation({ summary: 'Get details of a specific superadmin' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  getSuperAdmin(@Param('id') id: string) {
    return this.internalOpsService.getSuperAdminById(id);
  }

  @Patch('superadmins/:id')
  @ApiOperation({ summary: 'Update superadmin profile, status, or reset password' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  updateSuperAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateSuperAdminDto,
  ) {
    return this.internalOpsService.updateSuperAdmin(id, dto);
  }

  @Delete('superadmins/:id')
  @ApiOperation({
    summary: 'Revoke superadmin role or delete account',
    description: 'Demotes user to regular platform user or permanently removes user.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiQuery({ name: 'deletePermanently', required: false, type: Boolean })
  revokeSuperAdmin(
    @Param('id') id: string,
    @Query('deletePermanently') deletePermanently?: string,
  ) {
    const shouldDelete = deletePermanently === 'true' || deletePermanently === '1';
    return this.internalOpsService.revokeSuperAdmin(id, shouldDelete);
  }

  // ─────────────────────────────────────────────────────────
  // TEST DATA & EMAIL GENERATOR
  // ─────────────────────────────────────────────────────────

  @Post('test-data/emails/trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger & render test emails on demand anywhere',
    description:
      'Dynamically interpolates and renders any email template (WELCOME, COMMISSIONS, PAYOUTS, INVOICES, SECURITY) for visual verification or testing delivery.',
  })
  triggerTestEmail(@Body() dto: TriggerTestEmailDto) {
    return this.internalOpsService.triggerTestEmail(dto);
  }

  @Post('test-data/documents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate test document snapshots (Invoices, Statements, Certificates)',
    description:
      'Generates a print-ready document snapshot with Montserrat typography and registers it in the GeneratedDocument database table.',
  })
  generateTestDocument(@Body() dto: GenerateTestDocumentDto) {
    return this.internalOpsService.generateTestDocument(dto);
  }

  @Post('test-data/sandbox-org')
  @ApiOperation({
    summary: 'Provision a complete sandbox organization with affiliates and tracking links',
  })
  seedSandboxOrg(@Body() dto: SeedSandboxOrgDto) {
    return this.internalOpsService.seedSandboxOrg(dto);
  }

  @Post('test-data/seed-full')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run full database seed on demand without restarting the server',
  })
  runFullSeed() {
    return this.internalOpsService.runFullSeedOnDemand();
  }

  @Delete('test-data/purge-all-demo-data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Purge all dummy/demo organizations and users from the database',
    description: 'Removes legacy demo organizations (Acme, ZenPay, Nova, FitLife) and demo users while keeping real provisioned superadmins intact.',
  })
  purgeAllDemoData() {
    return this.internalOpsService.purgeAllDemoData();
  }

  // ─────────────────────────────────────────────────────────
  // SYSTEM HEALTH & STATS
  // ─────────────────────────────────────────────────────────

  @Get('system/stats')
  @ApiOperation({
    summary: 'Get real-time database and system statistics',
  })
  getSystemStats() {
    return this.internalOpsService.getSystemOverview();
  }
}

