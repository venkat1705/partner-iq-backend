import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminAuditService } from './admin-audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import type { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Admin - Audit Logs Operations')
@Controller('api/v1/admin/audit-logs')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminAuditController {
  constructor(private readonly adminAuditService: AdminAuditService) { }

  @Get('overview')
  @ApiOperation({ summary: 'Get audit operations overview KPIs, time-series, breakdowns, and signals' })
  async getOverview(@Query('period') period?: string) {
    return this.adminAuditService.getOverview(period);
  }

  @Get('events')
  @ApiOperation({ summary: 'Get paginated audit events with server-side filters' })
  async getEvents(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('actorType') actorType?: string,
    @Query('organizationId') organizationId?: string,
    @Query('result') result?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminAuditService.getEvents({
      page,
      limit,
      search,
      category,
      action,
      actorId,
      actorType,
      organizationId,
      result,
      targetType,
      targetId,
      from,
      to,
    });
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Get complete audit investigation dossier including before/after diff' })
  async getEventDetail(@Param('id') id: string) {
    return this.adminAuditService.getEventDetail(id);
  }

  @Get('categories/:category')
  @ApiOperation({ summary: 'Get filtered audit events by category' })
  async getCategoryEvents(
    @Param('category') category: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.adminAuditService.getCategoryEvents(category, { page, limit, search });
  }

  @Get('integrity')
  @ApiOperation({ summary: 'Cryptographically verify audit SHA-256 hash chain' })
  async verifyIntegrity() {
    return this.adminAuditService.verifyIntegrity();
  }

  @Get('retention')
  @ApiOperation({ summary: 'Get statutory retention policies and archive health' })
  async getRetention() {
    return this.adminAuditService.getRetentionPolicies();
  }

  @Post('export')
  @ApiOperation({ summary: 'Generate audited CSV/JSON export of audit records' })
  async exportAuditLogs(
    @Body() body: { category?: string; from?: string; to?: string; format?: string },
    @Req() req: RequestWithUser,
  ) {
    const actor = {
      id: req.user?.userId || (req.user as any)?.id || 'admin_operator',
      email: req.user?.email || 'admin@partneriq.com',
    };
    return this.adminAuditService.exportAuditLogs(body, actor);
  }
}

