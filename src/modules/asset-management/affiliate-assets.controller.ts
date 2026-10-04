import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { pipeline } from 'stream';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AffiliateAssetsService, PortalUser } from './affiliate-assets.service';
import { RecordAssetActivityDto } from './dto/asset-management.dto';

class PortalOrgQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

class PortalAssetListQueryDto extends PortalOrgQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** default and maximum 500 (most recently updated first) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

class PortalDownloadQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsIn(['attachment', 'inline'])
  disposition?: 'attachment' | 'inline';
}

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

function portalUser(req: any): PortalUser {
  const email = String(req.user?.email || '').toLowerCase().trim();
  return { email, userId: req.user?.userId || req.user?.id || req.user?.sub };
}

/**
 * Affiliate portal: marketing files and bundles the signed-in affiliate may use. Files are only reachable through
 * short-lived signed links created here after the access check (asset-access.ts).
 */
@ApiTags('Affiliate Portal — Assets')
@Controller(['api/v1/affiliate/me', 'affiliate/me'])
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AffiliateAssetsController {
  constructor(private readonly service: AffiliateAssetsService) {}

  @Get('assets')
  @ApiOperation({ summary: 'Marketing files this affiliate may use (published, shared, in their programs, not tier-locked)' })
  listAssets(@Req() req: any, @Query() query: PortalAssetListQueryDto) {
    return this.service.listAssets(portalUser(req), query.organizationId, { page: query.page, limit: query.limit });
  }

  @Get('assets/:assetId/download')
  @ApiOperation({ summary: 'Short-lived signed download link (after the access check)' })
  download(@Req() req: any, @Param('assetId', uuid) assetId: string, @Query() query: PortalDownloadQueryDto) {
    return this.service.getDownloadUrl(portalUser(req), assetId, query.disposition);
  }

  @Get('assets/:assetId/thumbnail')
  thumbnail(@Req() req: any, @Param('assetId', uuid) assetId: string) {
    return this.service.getThumbnailUrl(portalUser(req), assetId);
  }

  @Post('assets/:assetId/activity')
  @HttpCode(HttpStatus.OK)
  recordActivity(@Req() req: any, @Param('assetId', uuid) assetId: string, @Body() dto: RecordAssetActivityDto) {
    return this.service.recordActivity(portalUser(req), assetId, dto);
  }

  @Get('asset-bundles')
  @ApiOperation({ summary: 'Bundles this affiliate can see; tier-locked bundles are listed as locked without files' })
  listBundles(@Req() req: any, @Query() query: PortalOrgQueryDto) {
    return this.service.listBundles(portalUser(req), query.organizationId);
  }

  @Get('asset-bundles/:bundleId')
  getBundle(@Req() req: any, @Param('bundleId', uuid) bundleId: string) {
    return this.service.getBundle(portalUser(req), bundleId);
  }

  @Get('asset-bundles/:bundleId/zip')
  @ApiOperation({ summary: 'Download an unlocked bundle as a ZIP (streamed)' })
  async zip(@Req() req: any, @Param('bundleId', uuid) bundleId: string, @Res() res: Response) {
    const z = await this.service.zip(portalUser(req), bundleId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${z.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    pipeline(z.stream(), res, () => undefined);
  }
}
