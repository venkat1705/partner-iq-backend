import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
// PublishCertificateInput is an interface, so it has to be a type-only import:
// the dev server transpiles each file in isolation and would otherwise emit a
// runtime named import for it, which the module cannot provide.
import type { PublishCertificateInput } from './tax-certificates.service';
import { TaxCertificatesService } from './tax-certificates.service';

/**
 * Staff-only management of affiliate tax certificates. Issuing a certificate is
 * a statutory act on the platform's behalf, so it sits behind the platform admin
 * guard rather than any organization role.
 */
@ApiTags('Platform Admin - Tax Certificates')
@Controller('api/v1/admin/tax-certificates')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminTaxCertificatesController {
  constructor(private readonly service: TaxCertificatesService) {}

  @Get()
  @ApiOperation({ summary: 'List every published or draft affiliate tax certificate' })
  list(
    @Query('userId') userId?: string,
    @Query('financialYear') financialYear?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listAll({ userId, financialYear, status });
  }

  @Post()
  @ApiOperation({ summary: 'Publish a tax certificate to one affiliate' })
  publish(@Body() body: PublishCertificateInput, @CurrentUser() user: AuthUserPayload) {
    return this.service.publish(body, user.userId);
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
  constructor(private readonly service: TaxCertificatesService) {}

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
