import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireAnyPermission } from '../../common/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { UploadImageDto } from './dto/media.dto';
import { MediaService } from './media.service';

@ApiTags('Media')
@Controller('api/v1/organizations/:organizationId/media')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class MediaController {
  constructor(private readonly mediaService: MediaService) { }

  @Post('images')
  @RequireAnyPermission('manage.programs', 'assets.create')
  @RequireAnyPermission('manage.programs', 'assets.create', 'workspace.manage', 'branding.update', 'organizations.update')
  @ApiOperation({ summary: 'Upload an organization image asset to Cloudinary' })
  uploadImage(
    @Param('organizationId') organizationId: string,
    @Body() dto: UploadImageDto,
  ) {
    return this.mediaService.uploadImage(organizationId, dto);
  }
}
