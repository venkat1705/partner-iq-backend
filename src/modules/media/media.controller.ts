import { BadRequestException, Controller, Get, Header, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { MediaService, ORG_MEDIA_PURPOSES } from './media.service';

@ApiTags('Media')
@Controller('api/v1/organizations/:organizationId/media')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('images')
  @RequireAnyPermission('manage.programs', 'assets.create', 'workspace.manage', 'branding.update', 'organizations.update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a logo/banner image (multipart: "purpose" field, then the "file" part)' })
  uploadImage(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthUserPayload, @Req() req: Request) {
    return this.mediaService.uploadImage(req, (purpose) => {
      if (!ORG_MEDIA_PURPOSES.includes(purpose as any)) throw new BadRequestException(`purpose must be one of ${ORG_MEDIA_PURPOSES.join(', ')}`);
      return { kind: 'org', organizationId, purpose: purpose as any };
    }, user.userId);
  }
}

/** Public images (logos, banners, avatars): redirect to a short-lived signed URL; the bucket stays private. */
@ApiTags('Media')
@Controller('api/v1/media')
export class PublicMediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':mediaId')
  @Header('Cache-Control', 'private, max-age=60')
  async image(@Param('mediaId') mediaId: string, @Res() res: Response) {
    const { url } = await this.mediaService.publicUrl(mediaId);
    res.redirect(302, url);
  }
}
