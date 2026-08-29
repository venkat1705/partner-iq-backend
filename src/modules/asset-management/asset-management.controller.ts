import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { AssetManagementService } from './asset-management.service';
import {
  AddAssetVersionDto,
  AddBundleAssetDto,
  CreateAssetBundleDto,
  CreateAssetDto,
  CreateUploadUrlDto,
  ListAssetsQueryDto,
  RecordAssetActivityDto,
  ReorderBundleAssetsDto,
  UpdateAssetBundleDto,
  UpdateAssetDto,
} from './dto/asset-management.dto';

@ApiTags('Asset Management')
@Controller('api/v1/organizations/:organizationId')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class AssetManagementController {
  constructor(private readonly service: AssetManagementService) {}

  @Post('assets/upload-url')
  @RequirePermissions('assets.create')
  @ApiOperation({ summary: 'Create a secure signed upload URL for an asset' })
  createUploadUrl(@Param('organizationId') organizationId: string, @Body() dto: CreateUploadUrlDto) {
    return this.service.createUploadUrl(organizationId, dto);
  }

  @Post('assets')
  @RequirePermissions('assets.create')
  createAsset(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: CreateAssetDto) {
    return this.service.createAsset(organizationId, user.userId, dto);
  }

  @Get('assets')
  @RequirePermissions('assets.view')
  listAssets(@Param('organizationId') organizationId: string, @Query() query: ListAssetsQueryDto) {
    return this.service.listAssets(organizationId, query);
  }

  @Get('assets/:assetId')
  @RequirePermissions('assets.view')
  getAsset(@Param('organizationId') organizationId: string, @Param('assetId') assetId: string) {
    return this.service.getAsset(organizationId, assetId);
  }

  @Patch('assets/:assetId')
  @RequirePermissions('assets.edit')
  updateAsset(
    @Param('organizationId') organizationId: string,
    @Param('assetId') assetId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.service.updateAsset(organizationId, assetId, user.userId, dto);
  }

  @Delete('assets/:assetId')
  @RequirePermissions('assets.delete')
  archiveAsset(@Param('organizationId') organizationId: string, @Param('assetId') assetId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.archiveAsset(organizationId, assetId, user.userId);
  }

  @Post('assets/:assetId/version')
  @RequirePermissions('assets.edit')
  addVersion(
    @Param('organizationId') organizationId: string,
    @Param('assetId') assetId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: AddAssetVersionDto,
  ) {
    return this.service.addVersion(organizationId, assetId, user.userId, dto);
  }

  @Get('assets/:assetId/versions')
  @RequirePermissions('assets.view')
  listVersions(@Param('organizationId') organizationId: string, @Param('assetId') assetId: string) {
    return this.service.listVersions(organizationId, assetId);
  }

  @Post('assets/:assetId/restore/:versionId')
  @RequirePermissions('assets.edit')
  restoreVersion(
    @Param('organizationId') organizationId: string,
    @Param('assetId') assetId: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.service.restoreVersion(organizationId, assetId, versionId, user.userId);
  }

  @Post('asset-bundles')
  @RequirePermissions('assetBundles.create')
  createBundle(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: CreateAssetBundleDto) {
    return this.service.createBundle(organizationId, user.userId, dto);
  }

  @Get('asset-bundles')
  @RequirePermissions('assetBundles.view')
  listBundles(@Param('organizationId') organizationId: string) {
    return this.service.listBundles(organizationId);
  }

  @Get('asset-bundles/:bundleId')
  @RequirePermissions('assetBundles.view')
  getBundle(@Param('organizationId') organizationId: string, @Param('bundleId') bundleId: string) {
    return this.service.getBundle(organizationId, bundleId);
  }

  @Patch('asset-bundles/:bundleId')
  @RequirePermissions('assetBundles.edit')
  updateBundle(
    @Param('organizationId') organizationId: string,
    @Param('bundleId') bundleId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateAssetBundleDto,
  ) {
    return this.service.updateBundle(organizationId, bundleId, user.userId, dto);
  }

  @Delete('asset-bundles/:bundleId')
  @RequirePermissions('assetBundles.delete')
  archiveBundle(@Param('organizationId') organizationId: string, @Param('bundleId') bundleId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.archiveBundle(organizationId, bundleId, user.userId);
  }

  @Post('asset-bundles/:bundleId/assets')
  @RequirePermissions('assetBundles.edit')
  addBundleAsset(
    @Param('organizationId') organizationId: string,
    @Param('bundleId') bundleId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: AddBundleAssetDto,
  ) {
    return this.service.addBundleAsset(organizationId, bundleId, user.userId, dto);
  }

  @Delete('asset-bundles/:bundleId/assets/:assetId')
  @RequirePermissions('assetBundles.edit')
  removeBundleAsset(@Param('organizationId') organizationId: string, @Param('bundleId') bundleId: string, @Param('assetId') assetId: string) {
    return this.service.removeBundleAsset(organizationId, bundleId, assetId);
  }

  @Patch('asset-bundles/:bundleId/reorder')
  @RequirePermissions('assetBundles.edit')
  reorderBundleAssets(@Param('organizationId') organizationId: string, @Param('bundleId') bundleId: string, @Body() dto: ReorderBundleAssetsDto) {
    return this.service.reorderBundleAssets(organizationId, bundleId, dto);
  }

  @Post('asset-bundles/:bundleId/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assetBundles.publish')
  publishBundle(@Param('organizationId') organizationId: string, @Param('bundleId') bundleId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.publishBundle(organizationId, bundleId, user.userId);
  }

  @Post('asset-bundles/:bundleId/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assetBundles.publish')
  archiveBundlePost(@Param('organizationId') organizationId: string, @Param('bundleId') bundleId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.archiveBundle(organizationId, bundleId, user.userId);
  }

  @Get('affiliate/assets')
  @RequirePermissions('assets.download')
  listAffiliateAssets(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.listAffiliateAssets(organizationId, user.affiliateId || user.userId);
  }

  @Get('affiliate/asset-bundles')
  @RequirePermissions('assets.download')
  listAffiliateBundles(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.listAffiliateBundles(organizationId, user.affiliateId || user.userId);
  }

  @Get('affiliate/asset-bundles/:bundleId')
  @RequirePermissions('assets.download')
  getAffiliateBundle(@Param('organizationId') organizationId: string, @Param('bundleId') bundleId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.getAffiliateBundle(organizationId, bundleId, user.affiliateId || user.userId);
  }

  @Post('affiliate/assets/:assetId/activity')
  @RequirePermissions('assets.download')
  recordActivity(
    @Param('organizationId') organizationId: string,
    @Param('assetId') assetId: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: RecordAssetActivityDto,
  ) {
    return this.service.recordActivity(organizationId, user.affiliateId || user.userId, assetId, dto);
  }

  @Get('affiliate/assets/:assetId/download')
  @RequirePermissions('assets.download')
  getDownloadUrl(@Param('organizationId') organizationId: string, @Param('assetId') assetId: string, @CurrentUser() user: AuthUserPayload) {
    return this.service.getDownloadUrl(organizationId, user.affiliateId || user.userId, assetId);
  }

  @Get('asset-analytics')
  @RequirePermissions('assets.view')
  analytics(@Param('organizationId') organizationId: string) {
    return this.service.analytics(organizationId);
  }
}
