import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { StorageService } from '../../common/storage';
import { StorageQuotaService } from '../storage-quota/storage-quota.service';
import { SetStorageLimitDto } from './dto/asset-management.dto';
import { StorageJobsService } from './storage-jobs.service';

/** Platform administration of storage. Organization owners/admins cannot reach these routes (PlatformAdminGuard). */
@ApiTags('Platform Admin — Storage')
@Controller('api/v1/admin/storage')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class StorageAdminController {
  constructor(
    private readonly quota: StorageQuotaService,
    private readonly jobs: StorageJobsService,
    private readonly storage: StorageService,
  ) {}

  @Get('organizations/:organizationId')
  usage(@Param('organizationId', new ParseUUIDPipe()) organizationId: string) {
    return this.quota.getUsage(organizationId);
  }

  @Patch('organizations/:organizationId/limit')
  @ApiOperation({ summary: "Change an organization's storage limit (platform admins only)" })
  setLimit(@Param('organizationId', new ParseUUIDPipe()) organizationId: string, @CurrentUser() user: AuthUserPayload, @Body() dto: SetStorageLimitDto) {
    return this.quota.setLimit(organizationId, dto.limitBytes, user.userId, dto.reason);
  }

  @Post('jobs/:job/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run a storage job now: cleanup-reservations | purge-trash | reconcile | process-deletions' })
  async runJob(@Param('job') job: string) {
    const result = this.jobs.run(job);
    if (!result) throw new NotFoundException(`Unknown job "${job}"`);
    return (await result) ?? { skipped: true, reason: 'already running' };
  }

  @Get('bucket-settings')
  @ApiOperation({ summary: 'Bucket security settings as reported by the storage service' })
  bucketSettings() {
    return this.storage.describeBucketSettings();
  }
}
