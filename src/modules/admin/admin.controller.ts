import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';
import { AdminService } from './admin.service';

@ApiTags('Platform Admin')
@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get real platform admin data across all organizations' })
  getOverview(@CurrentUser() user: AuthUserPayload) {
    return this.adminService.getOverview(user);
  }
}
