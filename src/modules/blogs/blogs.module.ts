import { Module } from '@nestjs/common';
import { BlogsService } from './blogs.service';
import {
  AdminBlogsController,
  OrganizationBlogsController,
  AffiliateBlogsController,
  PublicBlogsController,
} from './blogs.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [
    AdminBlogsController,
    OrganizationBlogsController,
    AffiliateBlogsController,
    PublicBlogsController,
  ],
  providers: [BlogsService],
  exports: [BlogsService],
})
export class BlogsModule { }

