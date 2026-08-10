import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { FraudService } from './fraud.service';

@ApiTags('Fraud Risk Intelligence')
@Controller('api/v1/organizations/:organizationId/fraud')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class FraudController {
  constructor(private readonly fraudService: FraudService) {}

  @Get('dashboard')
  @RequirePermissions('fraud.read')
  @ApiOperation({ summary: 'Get organization fraud dashboard metrics and rollups' })
  getDashboard(@Param('organizationId') organizationId: string) {
    return this.fraudService.getDashboard(organizationId);
  }

  @Get('reviews')
  @RequirePermissions('fraud.read')
  @ApiOperation({ summary: 'List fraud reviews for organization' })
  getReviews(@Param('organizationId') organizationId: string) {
    return this.fraudService.getReviews(organizationId);
  }

  @Get('assessments/:assessmentId')
  @RequirePermissions('fraud.read')
  @ApiOperation({ summary: 'Get explainable fraud assessment with signals' })
  getAssessment(@Param('organizationId') organizationId: string, @Param('assessmentId') assessmentId: string) {
    return this.fraudService.getAssessment(organizationId, assessmentId);
  }

  @Get('settings')
  @RequirePermissions('fraud.read')
  @ApiOperation({ summary: 'Get organization or program fraud settings' })
  getSettings(@Param('organizationId') organizationId: string, @Query('programId') programId?: string) {
    return this.fraudService.getSettings(organizationId, programId);
  }

  @Put('settings')
  @RequirePermissions('fraud.settings.update')
  @ApiOperation({ summary: 'Create or update fraud settings' })
  upsertSettings(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() body: any,
  ) {
    return this.fraudService.upsertSettings(organizationId, user.userId, body);
  }

  @Post('reviews/:reviewId/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fraud.review')
  @ApiOperation({ summary: 'Assign a fraud review to an analyst' })
  assignReview(
    @Param('organizationId') organizationId: string,
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body('analystId') analystId: string,
  ) {
    return this.fraudService.assignReview(organizationId, reviewId, analystId, user.userId);
  }

  @Post('reviews/:reviewId/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fraud.review')
  @ApiOperation({ summary: 'Approve, reject, or escalate a fraud review' })
  resolveReview(
    @Param('organizationId') organizationId: string,
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body('decision') decision: 'APPROVED' | 'REJECTED' | 'ESCALATED',
    @Body('reason') reason?: string,
    @Body('notes') notes?: string,
  ) {
    return this.fraudService.resolveReview(organizationId, reviewId, decision, user.userId, reason, notes);
  }

  @Post('affiliates/:affiliateId/trust')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('fraud.review')
  @ApiOperation({ summary: 'Update affiliate trust score with history' })
  updateAffiliateTrust(
    @Param('organizationId') organizationId: string,
    @Param('affiliateId') affiliateId: string,
    @Body('score') score: number,
    @Body('reason') reason: string,
  ) {
    return this.fraudService.updateAffiliateTrust(organizationId, affiliateId, score, reason || 'Manual trust update', 'MANUAL' as any);
  }
}
