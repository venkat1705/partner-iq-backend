import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { pipeline } from 'stream';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { hasPermission } from '../../common/constants/permissions';
import { StorageQuotaService } from '../storage-quota/storage-quota.service';
import { AssetBundlesService } from './asset-bundles.service';
import { AssetManagementService } from './asset-management.service';
import { AssetUploadService } from './asset-upload.service';
import {
  AddBundleAssetDto,
  AddContentVersionDto,
  BulkAssetActionDto,
  CreateAssetBundleDto,
  CreateAssetDto,
  DownloadQueryDto,
  ListAssetsQueryDto,
  ReorderBundleAssetsDto,
  UpdateAssetBundleDto,
  UpdateAssetDto,
} from './dto/asset-management.dto';

const uuid = new ParseUUIDPipe({ version: undefined, errorHttpStatusCode: HttpStatus.NOT_FOUND });

@ApiTags('Asset Management')
@Controller('api/v1/organizations/:organizationId')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class AssetManagementController {
  constructor(
    private readonly service: AssetManagementService,
    private readonly bundles: AssetBundlesService,
    private readonly uploads: AssetUploadService,
    private readonly quota: StorageQuotaService,
  ) {}

  // ───────── storage usage ─────────

  @Get('storage/usage')
  @RequirePermissions('assets.view')
  @ApiOperation({ summary: 'Storage limit, usage (files, older versions, trash) and upload rules' })
  storageUsage(@Param('organizationId') organizationId: string) {
    return this.quota.getUsage(organizationId);
  }

  // ───────── uploads (multipart, streamed) ─────────

  @Post('assets/upload')
  @RequirePermissions('assets.create')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file asset (multipart: fields first, then the "file" part; header X-File-Size = file size in bytes)' })
  upload(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.uploads.upload(req, res, organizationId, user.userId, { kind: 'asset' }).then(async (r: any) => {
      res.status(HttpStatus.CREATED);
      return this.service.getAsset(organizationId, r.assetId);
    });
  }

  @Post('assets/:assetId/versions/upload')
  @RequirePermissions('assets.edit')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a new version (replace the file); older versions are kept until deleted' })
  uploadVersion(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string, @CurrentUser() user: AuthUserPayload, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.uploads.upload(req, res, organizationId, user.userId, { kind: 'version', assetId }).then(async (r: any) => {
      res.status(HttpStatus.CREATED);
      return this.service.getAsset(organizationId, r.assetId);
    });
  }

  // ───────── assets ─────────

  @Post('assets')
  @RequirePermissions('assets.create')
  @ApiOperation({ summary: 'Create a text, HTML or link asset (files: POST assets/upload)' })
  createAsset(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: CreateAssetDto) {
    return this.service.createAsset(organizationId, user.userId, dto);
  }

  @Get('assets')
  @RequirePermissions('assets.view')
  listAssets(@Param('organizationId') organizationId: string, @Query() query: ListAssetsQueryDto) {
    return this.service.listAssets(organizationId, query);
  }

  @Get('assets/folders')
  @RequirePermissions('assets.view')
  listFolders(@Param('organizationId') organizationId: string) {
    return this.service.listFolders(organizationId);
  }

  @Get('assets/trash')
  @RequirePermissions('assets.view')
  listTrash(@Param('organizationId') organizationId: string, @Query() query: ListAssetsQueryDto) {
    return this.service.listTrash(organizationId, query);
  }

  @Post('assets/trash/empty')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assets.delete')
  @ApiOperation({ summary: 'Permanently delete every file in the trash (frees the space immediately)' })
  emptyTrash(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.emptyTrash(organizationId, user.userId);
  }

  @Post('assets/bulk-action')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assets.edit')
  bulkAction(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: BulkAssetActionDto) {
    // moving to the trash is a delete: same permission as DELETE /assets/:id
    if (dto.action === 'ARCHIVE' && !hasPermission(user.role!, 'assets.delete')) {
      throw new ForbiddenException({ statusCode: 403, code: 'PERMISSION_DENIED', message: `Insufficient permissions for role '${user.role}'. Required: assets.delete` });
    }
    return this.service.bulkAction(organizationId, user.userId, dto);
  }

  @Get('assets/:assetId')
  @RequirePermissions('assets.view')
  getAsset(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string) {
    return this.service.getAsset(organizationId, assetId);
  }

  @Get('assets/:assetId/download')
  @RequirePermissions('assets.view')
  @ApiOperation({ summary: 'Short-lived signed download link (inline only for raster images)' })
  download(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string, @Query() query: DownloadQueryDto) {
    return this.service.getDownloadUrl(organizationId, assetId, query);
  }

  @Get('assets/:assetId/thumbnail')
  @RequirePermissions('assets.view')
  thumbnail(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string) {
    return this.service.getThumbnailUrl(organizationId, assetId);
  }

  @Get('assets/:assetId/usage-references')
  @RequirePermissions('assets.view')
  getAssetUsageReferences(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string) {
    return this.service.getAssetUsageReferences(organizationId, assetId);
  }

  @Patch('assets/:assetId')
  @RequirePermissions('assets.edit')
  updateAsset(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: UpdateAssetDto) {
    return this.service.updateAsset(organizationId, assetId, user.userId, dto);
  }

  @Delete('assets/:assetId')
  @RequirePermissions('assets.delete')
  @ApiOperation({ summary: 'Move to trash (kept and counted for the retention period)' })
  trashAsset(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.trashAsset(organizationId, assetId, user.userId);
  }

  @Post('assets/:assetId/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assets.delete')
  restoreAsset(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.restoreAsset(organizationId, assetId, user.userId);
  }

  @Delete('assets/:assetId/permanent')
  @RequirePermissions('assets.delete')
  @ApiOperation({ summary: 'Permanently delete a file that is in the trash' })
  permanentlyDelete(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.permanentlyDelete(organizationId, assetId, user.userId);
  }

  @Post('assets/:assetId/version')
  @RequirePermissions('assets.edit')
  @ApiOperation({ summary: 'New version of a text/HTML/link asset (files: POST assets/:assetId/versions/upload)' })
  addVersion(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: AddContentVersionDto) {
    return this.service.addVersion(organizationId, assetId, user.userId, dto);
  }

  @Get('assets/:assetId/versions')
  @RequirePermissions('assets.view')
  listVersions(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string) {
    return this.service.listVersions(organizationId, assetId);
  }

  @Post('assets/:assetId/restore/:versionId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assets.edit')
  restoreVersion(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string, @Param('versionId', uuid) versionId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.restoreVersion(organizationId, assetId, versionId, user.userId);
  }

  @Delete('assets/:assetId/versions/:versionId')
  @RequirePermissions('assets.delete')
  @ApiOperation({ summary: 'Delete an older version (frees its space)' })
  deleteVersion(@Param('organizationId') organizationId: string, @Param('assetId', uuid) assetId: string, @Param('versionId', uuid) versionId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.deleteVersion(organizationId, assetId, versionId, user.userId);
  }

  // ───────── bundles ─────────

  @Post('asset-bundles')
  @RequirePermissions('assetBundles.create')
  createBundle(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: CreateAssetBundleDto) {
    return this.bundles.createBundle(organizationId, user.userId, dto);
  }

  @Get('asset-bundles')
  @RequirePermissions('assetBundles.view')
  listBundles(@Param('organizationId') organizationId: string) {
    return this.bundles.listBundles(organizationId);
  }

  @Get('asset-bundles/:bundleId')
  @RequirePermissions('assetBundles.view')
  getBundle(@Param('organizationId') organizationId: string, @Param('bundleId', uuid) bundleId: string) {
    return this.bundles.getBundle(organizationId, bundleId);
  }

  @Get('asset-bundles/:bundleId/zip')
  @RequirePermissions('assetBundles.view')
  @ApiOperation({ summary: 'Download the bundle as a ZIP (streamed)' })
  async zip(@Param('organizationId') organizationId: string, @Param('bundleId', uuid) bundleId: string, @Res() res: Response) {
    const z = await this.bundles.zipForOrganization(organizationId, bundleId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${z.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    pipeline(z.stream(), res, () => undefined);
  }

  @Patch('asset-bundles/:bundleId')
  @RequirePermissions('assetBundles.edit')
  updateBundle(@Param('organizationId') organizationId: string, @Param('bundleId', uuid) bundleId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: UpdateAssetBundleDto) {
    return this.bundles.updateBundle(organizationId, bundleId, user.userId, dto);
  }

  @Delete('asset-bundles/:bundleId')
  @RequirePermissions('assetBundles.delete')
  archiveBundle(@Param('organizationId') organizationId: string, @Param('bundleId', uuid) bundleId: string, @CurrentUser() user: AuthUserPayload) {
    return this.bundles.archiveBundle(organizationId, bundleId, user.userId);
  }

  @Post('asset-bundles/:bundleId/assets')
  @RequirePermissions('assetBundles.edit')
  addBundleAsset(@Param('organizationId') organizationId: string, @Param('bundleId', uuid) bundleId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: AddBundleAssetDto) {
    return this.bundles.addBundleAsset(organizationId, bundleId, user.userId, dto);
  }

  @Delete('asset-bundles/:bundleId/assets/:assetId')
  @RequirePermissions('assetBundles.edit')
  removeBundleAsset(@Param('organizationId') organizationId: string, @Param('bundleId', uuid) bundleId: string, @Param('assetId', uuid) assetId: string, @CurrentUser() user: AuthUserPayload) {
    return this.bundles.removeBundleAsset(organizationId, bundleId, assetId, user.userId);
  }

  @Patch('asset-bundles/:bundleId/reorder')
  @RequirePermissions('assetBundles.edit')
  reorderBundleAssets(@Param('organizationId') organizationId: string, @Param('bundleId', uuid) bundleId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: ReorderBundleAssetsDto) {
    return this.bundles.reorderBundleAssets(organizationId, bundleId, user.userId, dto);
  }

  @Post('asset-bundles/:bundleId/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assetBundles.publish')
  publishBundle(@Param('organizationId') organizationId: string, @Param('bundleId', uuid) bundleId: string, @CurrentUser() user: AuthUserPayload) {
    return this.bundles.publishBundle(organizationId, bundleId, user.userId);
  }

  @Post('asset-bundles/:bundleId/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assetBundles.delete')
  archiveBundlePost(@Param('organizationId') organizationId: string, @Param('bundleId', uuid) bundleId: string, @CurrentUser() user: AuthUserPayload) {
    return this.bundles.archiveBundle(organizationId, bundleId, user.userId);
  }

  // ───────── analytics ─────────

  @Get('asset-analytics')
  @RequirePermissions('assets.view')
  analytics(@Param('organizationId') organizationId: string) {
    return this.service.analytics(organizationId);
  }

  @Get('asset-analytics/storage')
  @RequirePermissions('assets.view')
  storageAnalytics(@Param('organizationId') organizationId: string) {
    return this.service.getStorageAnalytics(organizationId);
  }

  @Get('asset-analytics/usage-intelligence')
  @RequirePermissions('assets.view')
  usageIntelligence(@Param('organizationId') organizationId: string) {
    return this.service.getUsageIntelligence(organizationId);
  }

  @Get('asset-activity')
  @RequirePermissions('assets.view')
  assetActivity(@Param('organizationId') organizationId: string) {
    return this.service.getAssetActivity(organizationId);
  }
}
