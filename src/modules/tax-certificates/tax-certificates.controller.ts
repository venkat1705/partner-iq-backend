import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import type { PublishCertificateInput } from './tax-certificates.service';
import { TaxCertificatesService } from './tax-certificates.service';

/**
 * Staff-only management of affiliate tax certificates, regulatory documents,
 * tax profiles, and compliance verification across jurisdictions.
 */
@ApiTags('Platform Admin - Tax & Compliance')
@Controller('api/v1/admin/tax-certificates')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminTaxCertificatesController {
  constructor(private readonly service: TaxCertificatesService) { }

  @Get('analytics')
  @ApiOperation({ summary: 'Get aggregated compliance metrics, status breakdown, and trend' })
  getAnalytics(@Query('jurisdiction') jurisdiction?: string) {
    return this.service.getAnalytics(jurisdiction);
  }

  @Get('profiles')
  @ApiOperation({ summary: 'List structured tax profiles with residency, masked tax IDs, and withholding rates' })
  listProfiles(
    @Query('jurisdiction') jurisdiction?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listProfiles({ jurisdiction, status });
  }

  @Get('jurisdictions')
  @ApiOperation({ summary: 'List normalized tax jurisdiction specifications (IN, US, GB, EU, etc.)' })
  listJurisdictions() {
    return this.service.listJurisdictions();
  }

  @Get('templates')
  @ApiOperation({ summary: 'List registered tax certificate and form templates' })
  listTemplates() {
    return this.service.listTemplates();
  }

  @Get()
  @ApiOperation({ summary: 'List every published, draft, or revoked tax certificate / regulatory document' })
  list(
    @Query('userId') userId?: string,
    @Query('financialYear') financialYear?: string,
    @Query('status') status?: string,
    @Query('jurisdiction') jurisdiction?: string,
  ) {
    return this.service.listAll({ userId, financialYear, status, jurisdiction });
  }

  @Post()
  @ApiOperation({ summary: 'Publish a tax certificate or compliance document to one affiliate' })
  publish(@Body() body: PublishCertificateInput, @CurrentUser() user: AuthUserPayload) {
    return this.service.publish(body, user.userId);
  }

  @Post(':id/verify')
  @ApiOperation({ summary: 'Verify an uploaded or published tax document' })
  verify(
    @Param('id') id: string,
    @Body() body: { method?: string; notes?: string },
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.service.verifyDocument(id, user.userId, body?.method, body?.notes);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a tax document with actionable reason and required correction' })
  reject(
    @Param('id') id: string,
    @Body() body: { reason?: string; requiredCorrection?: string; notes?: string },
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.service.rejectDocument(
      id,
      user.userId,
      body?.reason,
      body?.requiredCorrection,
      body?.notes,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Amend or revoke a published certificate' })
  update(
    @Param('id') id: string,
    @Body() body: Partial<PublishCertificateInput>,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.service.update(id, body, user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Permanently delete a certificate' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.remove(id, user.userId);
  }
}

/**
 * The affiliate's read-only view. There is deliberately no write path here: a
 * partner can list and download what was issued to them and nothing else.
 */
@ApiTags('Affiliate Tax Certificates')
@Controller('api/v1/affiliate/me/tax-certificates')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AffiliateTaxCertificatesController {
  constructor(private readonly service: TaxCertificatesService) { }

  private resolveUserId(req: any): string {
    return req.user?.userId || req.user?.id || req.user?.sub;
  }

  @Get()
  @ApiOperation({ summary: 'List tax certificates published to the current affiliate' })
  list(@Req() req: any) {
    return this.service.listForAffiliate(this.resolveUserId(req));
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Resolve the download URL for one of the affiliate own certificates' })
  download(@Param('id') id: string, @Req() req: any) {
    return this.service.getDownloadUrl(id, this.resolveUserId(req));
  }
}
