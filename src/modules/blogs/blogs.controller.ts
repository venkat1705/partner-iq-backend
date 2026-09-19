import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BlogsService } from './blogs.service';
import { CreateBlogDto, UpdateBlogDto, QueryBlogsDto } from './dto/blogs.dto';

// ================= PLATFORM ADMIN CONTROLLER =================

@ApiTags('Admin Blogs')
@Controller('api/v1/admin/blogs')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class AdminBlogsController {
  constructor(private readonly blogsService: BlogsService) { }

  @Get()
  @ApiOperation({ summary: 'List all blogs across all organizations and global catalog' })
  list(@Query() query: QueryBlogsDto) {
    return this.blogsService.listAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific blog post by ID' })
  getOne(@Param('id') id: string) {
    return this.blogsService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new global or organization-scoped blog post' })
  create(@Body() dto: CreateBlogDto, @Req() req: any) {
    const actor = {
      userId: req.user?.userId || req.user?.id || 'admin',
      role: req.user?.role,
      isSuperAdmin: true,
    };
    return this.blogsService.create(dto, actor);
  }

  @Put(':id')
  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing blog post' })
  update(@Param('id') id: string, @Body() dto: UpdateBlogDto, @Req() req: any) {
    const actor = {
      userId: req.user?.userId || req.user?.id || 'admin',
      role: req.user?.role,
      isSuperAdmin: true,
    };
    return this.blogsService.update(id, dto, actor);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish a blog post' })
  publish(@Param('id') id: string, @Req() req: any) {
    const actor = {
      userId: req.user?.userId || req.user?.id || 'admin',
      isSuperAdmin: true,
    };
    return this.blogsService.publish(id, actor);
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: 'Unpublish a blog post (revert to DRAFT)' })
  unpublish(@Param('id') id: string, @Req() req: any) {
    const actor = {
      userId: req.user?.userId || req.user?.id || 'admin',
      isSuperAdmin: true,
    };
    return this.blogsService.unpublish(id, actor);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate a blog post' })
  duplicate(@Param('id') id: string, @Req() req: any) {
    const actor = {
      userId: req.user?.userId || req.user?.id || 'admin',
      isSuperAdmin: true,
    };
    return this.blogsService.duplicate(id, actor);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a blog post' })
  delete(@Param('id') id: string, @Req() req: any) {
    const actor = {
      userId: req.user?.userId || req.user?.id || 'admin',
      isSuperAdmin: true,
    };
    return this.blogsService.delete(id, actor);
  }
}

// ================= ORGANIZATION CONTROLLER =================

@ApiTags('Organization Blogs')
@Controller('api/v1/organizations/:organizationId/blogs')
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
@ApiBearerAuth()
export class OrganizationBlogsController {
  constructor(private readonly blogsService: BlogsService) { }

  @Get()
  @RequirePermissions('blogs.read')
  @ApiOperation({ summary: 'List blogs belonging strictly to this organization' })
  list(@Param('organizationId') organizationId: string, @Query() query: QueryBlogsDto) {
    return this.blogsService.listForOrganization(organizationId, query);
  }

  @Get(':id')
  @RequirePermissions('blogs.read')
  @ApiOperation({ summary: 'Get a specific organization blog post' })
  getOne(@Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.blogsService.findById(id, organizationId);
  }

  @Post()
  @RequirePermissions('blogs.create')
  @ApiOperation({ summary: 'Create a blog post scoped to this organization' })
  create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateBlogDto,
    @Req() req: any,
  ) {
    const actor = {
      userId: req.user?.userId || req.user?.id,
      role: req.user?.role,
      isSuperAdmin: Boolean(req.user?.isSuperAdmin),
    };
    return this.blogsService.create(dto, actor, {
      scopeType: 'ORGANIZATION',
      organizationId,
    });
  }

  @Put(':id')
  @Patch(':id')
  @RequirePermissions('blogs.update')
  @ApiOperation({ summary: 'Update an organization blog post' })
  update(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBlogDto,
    @Req() req: any,
  ) {
    const actor = {
      userId: req.user?.userId || req.user?.id,
      role: req.user?.role,
      isSuperAdmin: Boolean(req.user?.isSuperAdmin),
    };
    return this.blogsService.update(id, dto, actor, organizationId);
  }

  @Post(':id/publish')
  @RequirePermissions('blogs.publish')
  @ApiOperation({ summary: 'Publish an organization blog post' })
  publish(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const actor = {
      userId: req.user?.userId || req.user?.id,
      isSuperAdmin: Boolean(req.user?.isSuperAdmin),
    };
    return this.blogsService.publish(id, actor, organizationId);
  }

  @Post(':id/unpublish')
  @RequirePermissions('blogs.publish')
  @ApiOperation({ summary: 'Unpublish an organization blog post' })
  unpublish(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const actor = {
      userId: req.user?.userId || req.user?.id,
      isSuperAdmin: Boolean(req.user?.isSuperAdmin),
    };
    return this.blogsService.unpublish(id, actor, organizationId);
  }

  @Post(':id/duplicate')
  @RequirePermissions('blogs.create')
  @ApiOperation({ summary: 'Duplicate an organization blog post' })
  duplicate(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const actor = {
      userId: req.user?.userId || req.user?.id,
      isSuperAdmin: Boolean(req.user?.isSuperAdmin),
    };
    return this.blogsService.duplicate(id, actor, organizationId);
  }

  @Delete(':id')
  @RequirePermissions('blogs.delete')
  @ApiOperation({ summary: 'Delete an organization blog post' })
  delete(
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const actor = {
      userId: req.user?.userId || req.user?.id,
      isSuperAdmin: Boolean(req.user?.isSuperAdmin),
    };
    return this.blogsService.delete(id, actor, organizationId);
  }
}

// ================= AFFILIATE SELF PORTAL CONTROLLER =================

@ApiTags('Affiliate Blogs')
@Controller(['api/v1/affiliate/me/blogs', 'affiliate/me/blogs'])
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AffiliateBlogsController {
  constructor(private readonly blogsService: BlogsService) { }

  @Get()
  @ApiOperation({ summary: 'Get educational blogs available to current affiliate (Global + Partnered Orgs)' })
  list(@Req() req: any, @Query() query: QueryBlogsDto) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const email = req.user?.email;
    return this.blogsService.listForAffiliate(userId, email, query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get an authorized article by URL slug' })
  getBySlug(@Param('slug') slug: string, @Req() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    const email = req.user?.email;
    return this.blogsService.findBySlug(slug, { userId, email });
  }
}

// ================= PUBLIC BLOGS CONTROLLER =================

@ApiTags('Public Blogs')
@Controller('api/v1/blogs')
export class PublicBlogsController {
  constructor(private readonly blogsService: BlogsService) { }

  @Get()
  @ApiOperation({ summary: 'Get public educational blog catalog' })
  list(@Query() query: QueryBlogsDto) {
    return this.blogsService.listPublic(query);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get public blog post by URL slug' })
  getBySlug(@Param('slug') slug: string) {
    return this.blogsService.findBySlug(slug);
  }
}

