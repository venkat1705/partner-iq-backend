import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BlogAuthorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  twitter?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedin?: string;
}

export class CreateBlogDto {
  @ApiProperty({ description: 'Title of the blog post' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ description: 'URL slug of the article' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @ApiProperty({ description: 'Short summary or excerpt' })
  @IsString()
  excerpt!: string;

  @ApiProperty({ description: 'Article content sections or markdown/HTML string' })
  content!: any;

  @ApiProperty({ description: 'Category identifier' })
  @IsString()
  category!: string;

  @ApiPropertyOptional({ description: 'List of tags' })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: 'Author details' })
  @IsOptional()
  @IsObject()
  author?: BlogAuthorDto;

  @ApiPropertyOptional({ description: 'Cover image URL' })
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiPropertyOptional({ description: 'Social share / Open Graph image URL' })
  @IsOptional()
  @IsString()
  ogImage?: string;

  @ApiPropertyOptional({ enum: ['GLOBAL', 'ORGANIZATION'] })
  @IsOptional()
  @IsEnum(['GLOBAL', 'ORGANIZATION'])
  scopeType?: 'GLOBAL' | 'ORGANIZATION';

  @ApiPropertyOptional({ description: 'Associated organization ID if organization-scoped' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsOptional()
  @IsEnum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  @ApiPropertyOptional({ description: 'Whether article is featured in spotlight hero' })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ description: 'Reading time estimate (e.g. 5 min read)' })
  @IsOptional()
  @IsString()
  readingTime?: string;

  @ApiPropertyOptional({ description: 'SEO title' })
  @IsOptional()
  @IsString()
  seoTitle?: string;

  @ApiPropertyOptional({ description: 'SEO meta description' })
  @IsOptional()
  @IsString()
  seoDescription?: string;

  @ApiPropertyOptional({ description: 'Canonical URL' })
  @IsOptional()
  @IsString()
  canonicalUrl?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateBlogDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  excerpt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  content?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  author?: BlogAuthorDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverImage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ogImage?: string;

  @ApiPropertyOptional({ enum: ['GLOBAL', 'ORGANIZATION'] })
  @IsOptional()
  @IsEnum(['GLOBAL', 'ORGANIZATION'])
  scopeType?: 'GLOBAL' | 'ORGANIZATION';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsOptional()
  @IsEnum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  readingTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  seoTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  seoDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  canonicalUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class QueryBlogsDto {
  @ApiPropertyOptional()
  @IsOptional()
  page?: string | number;

  @ApiPropertyOptional()
  @IsOptional()
  limit?: string | number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scopeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'] })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC';
}

