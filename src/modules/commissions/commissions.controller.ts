import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommissionsService } from './commissions.service';
import { CreateCommissionRuleDto } from './dto/commission.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Commissions Engine')
@Controller('api/v1/organizations/:organizationId/commissions')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) {}

  @Get()
  @RequirePermissions('view.commissions')
  @ApiOperation({ summary: 'List all commissions in organization' })
  async getCommissions(@Param('organizationId') organizationId: string) {
    return this.commissionsService.getCommissions(organizationId);
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
}
