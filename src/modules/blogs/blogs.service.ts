import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import { AppDataSource } from '../../database/data-source';
import { BlogPost, Organization, OrganizationBranding } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../common/enums';
import { DEFAULT_BLOG_POSTS } from './constants/default-blogs';
import { CreateBlogDto, UpdateBlogDto, QueryBlogsDto } from './dto/blogs.dto';

@Injectable()
export class BlogsService {
  private readonly logger = new Logger(BlogsService.name);

  constructor(private readonly auditService: AuditService) {
    this.ensureDefaultBlogs().catch((err) => {
      this.logger.warn(`Failed to seed initial default blogs: ${err.message}`);
    });
  }

  /**
   * Bootstraps the 10 educational default PartnerIQ blogs if database is empty.
   */
  async ensureDefaultBlogs(): Promise<void> {
    for (const post of DEFAULT_BLOG_POSTS) {
      const existing = dbStore.blogPosts.find((b) => b.slug === post.slug);
      if (existing) continue;

      const record: BlogPost = {
        id: uuidv4(),
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        content: post.content,
        coverImage: (post as any).coverImage,
        ogImage: (post as any).ogImage || `/og/blog-${post.slug}.svg`,
        category: post.category,
        tags: [...post.tags],
        author: { ...post.author },
        status: ((post as any).status?.toUpperCase() as any) || 'PUBLISHED',
        scopeType: 'GLOBAL',
        organizationId: undefined,
        readingTime: post.readingTime || '10 min read',
        featured: Boolean((post as any).featured),
        seoTitle: post.seoTitle || post.title,
        seoDescription: post.seoDescription || post.excerpt,
        canonicalUrl: post.canonicalUrl || `https://affiliate.partneriq.in/blog/${post.slug}`,
        createdById: undefined,
        updatedById: undefined,
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : new Date(),
        deletedAt: undefined,
        version: 1,
        metadata: { originalId: post.id },
        createdAt: new Date(),
        updatedAt: post.updatedAt ? new Date(post.updatedAt) : new Date(),
      };

      if (AppDataSource.isInitialized) {
        try {
          const repo = AppDataSource.getRepository(BlogPost);
          await repo.save(repo.create(record));
        } catch (e: any) {
          this.logger.debug(`Could not save blog post ${post.slug} via TypeORM: ${e.message}`);
        }
      }

      if (!dbStore.blogPosts.some((b) => b.slug === post.slug)) {
        dbStore.blogPosts.push(record);
      }
    }
  }

  /**
   * Generates a clean URL slug from any string.
   */
  slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Ensures slug uniqueness by appending incremental counter if needed.
   */
  async ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
    let slug = baseSlug || 'post';
    let counter = 1;

    while (true) {
      const matchInStore = dbStore.blogPosts.find(
        (b) => b.slug === slug && b.id !== excludeId && !b.deletedAt,
      );
      let matchInDb = false;
      if (AppDataSource.isInitialized) {
        try {
          const found = await AppDataSource.getRepository(BlogPost).findOne({ where: { slug } });
          if (found && found.id !== excludeId && !found.deletedAt) {
            matchInDb = true;
          }
        } catch {
          // ignore
        }
      }

      if (!matchInStore && !matchInDb) {
        return slug;
      }
      slug = `${baseSlug}-${counter++}`;
    }
  }

  /**
   * Estimates reading time based on total word count across text & sections.
   */
  calculateReadingTime(content: any, excerpt?: string): string {
    let text = excerpt || '';
    if (typeof content === 'string') {
      text += ' ' + content;
    } else if (Array.isArray(content)) {
      for (const section of content) {
        if (typeof section.content === 'string') text += ' ' + section.content;
        if (Array.isArray(section.content)) text += ' ' + section.content.join(' ');
        if (Array.isArray(section.takeaways)) text += ' ' + section.takeaways.join(' ');
        if (Array.isArray(section.faqs)) {
          for (const f of section.faqs) text += ` ${f.question} ${f.answer}`;
        }
        if (Array.isArray(section.steps)) {
          for (const s of section.steps) text += ` ${s.title} ${s.description}`;
        }
      }
    } else if (content && typeof content === 'object') {
      text += ' ' + JSON.stringify(content);
    }

    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.ceil(words / 200));
    return `${minutes} min read`;
  }

  /**
   * Hydrates organization branding data when present for organization-scoped posts.
   */
  private hydrateBranding(post: BlogPost): any {
    if (post.scopeType !== 'ORGANIZATION' || !post.organizationId) {
      return {
        ...post,
        organizationName: 'PartnerIQ',
        organizationSlug: 'partneriq',
        branding: {
          primaryColor: '#2563EB',
          logoUrl: '/icon-light.png',
        },
      };
    }

    const org = dbStore.organizations.find((o) => o.id === post.organizationId);
    const branding = dbStore.organizationBrandings.find((b) => b.organizationId === post.organizationId);

    return {
      ...post,
      organizationName: org?.name || 'Organization',
      organizationSlug: org?.slug || '',
      branding: {
        companyName: org?.name,
        primaryColor: branding?.primaryColor || '#2563EB',
        secondaryColor: branding?.secondaryColor,
        logoUrl: branding?.logoUrl,
        logoDarkUrl: branding?.logoDarkUrl,
        websiteUrl: (org as any)?.website || (org as any)?.websiteUrl,
      },
    };
  }

  // ================= ADMIN OPERATIONS =================

  async listAdmin(query: QueryBlogsDto) {
    let posts = dbStore.blogPosts.filter((p) => !p.deletedAt);

    if (query.scopeType && query.scopeType !== 'ALL') {
      posts = posts.filter((p) => p.scopeType === query.scopeType);
    }
    if (query.organizationId) {
      posts = posts.filter((p) => p.organizationId === query.organizationId);
    }
    if (query.status && query.status !== 'ALL') {
      posts = posts.filter((p) => p.status === query.status);
    }
    if (query.category && query.category !== 'ALL') {
      posts = posts.filter((p) => p.category === query.category);
    }
    if (query.search?.trim()) {
      const q = query.search.toLowerCase().trim();
      posts = posts.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          p.excerpt.toLowerCase().includes(q) ||
          p.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Sorting
    posts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const total = posts.length;
    const paginated = posts.slice((page - 1) * limit, page * limit).map((p) => this.hydrateBranding(p));

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ================= ORGANIZATION OPERATIONS =================

  async listForOrganization(organizationId: string, query: QueryBlogsDto) {
    let posts = dbStore.blogPosts.filter(
      (p) => !p.deletedAt && p.scopeType === 'ORGANIZATION' && p.organizationId === organizationId,
    );

    if (query.status && query.status !== 'ALL') {
      posts = posts.filter((p) => p.status === query.status);
    }
    if (query.category && query.category !== 'ALL') {
      posts = posts.filter((p) => p.category === query.category);
    }
    if (query.search?.trim()) {
      const q = query.search.toLowerCase().trim();
      posts = posts.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          p.excerpt.toLowerCase().includes(q) ||
          p.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    posts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const total = posts.length;
    const paginated = posts.slice((page - 1) * limit, page * limit).map((p) => this.hydrateBranding(p));

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ================= AFFILIATE RESOLUTION =================

  /**
   * Resolves:
   * 1. All GLOBAL published blogs
   * 2. ORGANIZATION published blogs for organizations the affiliate is enrolled in
   * Deduplicated by ID.
   */
  async listForAffiliate(
    affiliateUserId: string | undefined,
    affiliateEmail: string | undefined,
    query: QueryBlogsDto,
  ) {
    const normalizedEmail = affiliateEmail?.toLowerCase().trim();

    // Determine authorized organization memberships for affiliate
    let authorizedOrgIds: string[] = [];
    if (affiliateUserId || normalizedEmail) {
      const affiliateRecords = dbStore.affiliates.filter(
        (a) =>
          (affiliateUserId && a.userId === affiliateUserId) ||
          (normalizedEmail && a.email?.toLowerCase().trim() === normalizedEmail),
      );
      authorizedOrgIds = Array.from(new Set(affiliateRecords.map((a) => a.organizationId).filter(Boolean)));
    }

    // 1. Fetch Global Published Blogs
    const globalPosts = dbStore.blogPosts.filter(
      (p) => !p.deletedAt && p.scopeType === 'GLOBAL' && p.status === 'PUBLISHED',
    );

    // 2. Fetch Authorized Organization Published Blogs
    const orgPosts = authorizedOrgIds.length > 0
      ? dbStore.blogPosts.filter(
        (p) =>
          !p.deletedAt &&
          p.scopeType === 'ORGANIZATION' &&
          p.status === 'PUBLISHED' &&
          p.organizationId &&
          authorizedOrgIds.includes(p.organizationId),
      )
      : [];

    // Deduplicate by ID
    const seen = new Set<string>();
    const combined: BlogPost[] = [];
    for (const post of [...orgPosts, ...globalPosts]) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        combined.push(post);
      }
    }

    // Filter
    let filtered = combined;
    if (query.category && query.category !== 'ALL') {
      filtered = filtered.filter((p) => p.category === query.category);
    }
    if (query.tag) {
      const tagLower = query.tag.toLowerCase();
      filtered = filtered.filter((p) => p.tags?.some((t) => t.toLowerCase() === tagLower));
    }
    if (query.search?.trim()) {
      const q = query.search.toLowerCase().trim();
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          p.excerpt.toLowerCase().includes(q) ||
          p.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Sort: Featured first, then publishedAt DESC
    filtered.sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return timeB - timeA;
    });

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * limit, page * limit).map((p) => this.hydrateBranding(p));

    // Organization specific posts for "For You" feed
    const forYouPosts = orgPosts
      .filter((p) => (query.category && query.category !== 'ALL' ? p.category === query.category : true))
      .slice(0, 6)
      .map((p) => this.hydrateBranding(p));

    return {
      data: paginated,
      forYou: forYouPosts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ================= PUBLIC BLOGS =================

  async listPublic(query: QueryBlogsDto) {
    let posts = dbStore.blogPosts.filter(
      (p) => !p.deletedAt && p.scopeType === 'GLOBAL' && p.status === 'PUBLISHED',
    );

    if (query.category && query.category !== 'ALL') {
      posts = posts.filter((p) => p.category === query.category);
    }
    if (query.tag) {
      const tagLower = query.tag.toLowerCase();
      posts = posts.filter((p) => p.tags?.some((t) => t.toLowerCase() === tagLower));
    }
    if (query.search?.trim()) {
      const q = query.search.toLowerCase().trim();
      posts = posts.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          p.excerpt.toLowerCase().includes(q) ||
          p.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    posts.sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return timeB - timeA;
    });

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const total = posts.length;
    const paginated = posts.slice((page - 1) * limit, page * limit).map((p) => this.hydrateBranding(p));

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ================= GET BY ID OR SLUG =================

  async findById(id: string, organizationId?: string): Promise<any> {
    const post = dbStore.blogPosts.find((p) => p.id === id && !p.deletedAt);
    if (!post) {
      throw new NotFoundException(`Blog post with ID '${id}' not found`);
    }

    if (organizationId && post.scopeType === 'ORGANIZATION' && post.organizationId !== organizationId) {
      throw new ForbiddenException('You do not have access to this organization blog post');
    }

    return this.hydrateBranding(post);
  }

  async findBySlug(
    slug: string,
    affiliateIdentity?: { userId?: string; email?: string },
    organizationIdContext?: string,
  ): Promise<any> {
    const cleanSlug = slug.toLowerCase().trim();
    const post = dbStore.blogPosts.find((p) => p.slug.toLowerCase() === cleanSlug && !p.deletedAt);
    if (!post) {
      throw new NotFoundException(`Article '${slug}' not found`);
    }

    // 1. Global published blog -> always visible
    if (post.scopeType === 'GLOBAL' && post.status === 'PUBLISHED') {
      return this.hydrateBranding(post);
    }

    // 2. Organization published blog -> verify affiliate or org membership
    if (post.scopeType === 'ORGANIZATION') {
      if (organizationIdContext && organizationIdContext === post.organizationId) {
        return this.hydrateBranding(post);
      }

      if (affiliateIdentity && (affiliateIdentity.userId || affiliateIdentity.email)) {
        const email = affiliateIdentity.email?.toLowerCase().trim();
        const hasMembership = dbStore.affiliates.some(
          (a) =>
            a.organizationId === post.organizationId &&
            ((affiliateIdentity.userId && a.userId === affiliateIdentity.userId) ||
              (email && a.email?.toLowerCase().trim() === email)),
        );
        if (hasMembership && post.status === 'PUBLISHED') {
          return this.hydrateBranding(post);
        }
      }

      // If user is super admin viewing
      throw new ForbiddenException('You are not authorized to view this organization article');
    }

    // 3. Draft posts
    if (post.status === 'DRAFT') {
      if (organizationIdContext && post.organizationId === organizationIdContext) {
        return this.hydrateBranding(post);
      }
      throw new NotFoundException(`Article '${slug}' is currently unpublished`);
    }

    return this.hydrateBranding(post);
  }

  // ================= CRUD MUTATIONS =================

  async create(
    dto: CreateBlogDto,
    actor: { userId: string; role?: string; isSuperAdmin?: boolean },
    forcedScope?: { scopeType: 'GLOBAL' | 'ORGANIZATION'; organizationId?: string },
  ): Promise<any> {
    const scopeType = forcedScope?.scopeType || dto.scopeType || 'GLOBAL';
    const organizationId = forcedScope?.organizationId || dto.organizationId;

    if (scopeType === 'GLOBAL' && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only platform administrators can create global blogs');
    }

    if (scopeType === 'ORGANIZATION' && !organizationId) {
      throw new BadRequestException('organizationId is required for organization-scoped blogs');
    }

    const baseSlug = dto.slug ? this.slugify(dto.slug) : this.slugify(dto.title);
    const uniqueSlug = await this.ensureUniqueSlug(baseSlug);
    const readingTime = dto.readingTime || this.calculateReadingTime(dto.content, dto.excerpt);
    const status = dto.status || 'DRAFT';

    const author = dto.author || {
      name: 'PartnerIQ Editorial',
      role: 'Educational Content Team',
      avatarUrl: '/icon-light.png',
      bio: 'PartnerIQ partner marketing guides and tutorials.',
    };

    const newPost: BlogPost = {
      id: uuidv4(),
      title: dto.title.trim(),
      slug: uniqueSlug,
      excerpt: dto.excerpt.trim(),
      content: dto.content,
      coverImage: dto.coverImage,
      ogImage: dto.ogImage || `/og/blog-${uniqueSlug}.svg`,
      category: dto.category,
      tags: dto.tags || [],
      author,
      status,
      scopeType,
      organizationId,
      readingTime,
      featured: Boolean(dto.featured),
      seoTitle: dto.seoTitle || dto.title,
      seoDescription: dto.seoDescription || dto.excerpt,
      canonicalUrl: dto.canonicalUrl || `https://affiliate.partneriq.in/blog/${uniqueSlug}`,
      createdById: actor.userId,
      updatedById: actor.userId,
      publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
      deletedAt: undefined,
      version: 1,
      metadata: dto.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(BlogPost);
      await repo.save(repo.create(newPost));
    }

    dbStore.blogPosts.push(newPost);

    this.auditService.log({
      organizationId,
      actorType: 'user',
      actorId: actor.userId,
      action: AuditAction.BLOG_CREATED,
      resourceType: 'blog_post',
      resourceId: newPost.id,
      metadata: { title: newPost.title, slug: newPost.slug, scopeType, status },
    });

    return this.hydrateBranding(newPost);
  }

  async update(
    id: string,
    dto: UpdateBlogDto,
    actor: { userId: string; role?: string; isSuperAdmin?: boolean },
    organizationIdContext?: string,
  ): Promise<any> {
    const post = dbStore.blogPosts.find((p) => p.id === id && !p.deletedAt);
    if (!post) {
      throw new NotFoundException(`Blog post with ID '${id}' not found`);
    }

    if (post.scopeType === 'GLOBAL' && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only platform administrators can modify global blogs');
    }

    if (organizationIdContext && post.scopeType === 'ORGANIZATION' && post.organizationId !== organizationIdContext) {
      throw new ForbiddenException('Cannot modify a blog belonging to another organization');
    }

    let slug = post.slug;
    if (dto.slug && dto.slug !== post.slug) {
      slug = await this.ensureUniqueSlug(this.slugify(dto.slug), post.id);
    } else if (dto.title && dto.title !== post.title && !post.publishedAt) {
      // Auto-update slug if unpublished
      slug = await this.ensureUniqueSlug(this.slugify(dto.title), post.id);
    }

    if (dto.title !== undefined) post.title = dto.title.trim();
    post.slug = slug;
    if (dto.excerpt !== undefined) post.excerpt = dto.excerpt.trim();
    if (dto.content !== undefined) post.content = dto.content;
    if (dto.category !== undefined) post.category = dto.category;
    if (dto.tags !== undefined) post.tags = dto.tags;
    if (dto.author !== undefined) post.author = { ...post.author, ...dto.author };
    if (dto.coverImage !== undefined) post.coverImage = dto.coverImage;
    if (dto.ogImage !== undefined) post.ogImage = dto.ogImage;
    if (dto.featured !== undefined) post.featured = dto.featured;
    if (dto.seoTitle !== undefined) post.seoTitle = dto.seoTitle;
    if (dto.seoDescription !== undefined) post.seoDescription = dto.seoDescription;
    if (dto.canonicalUrl !== undefined) post.canonicalUrl = dto.canonicalUrl;
    if (dto.metadata !== undefined) post.metadata = { ...post.metadata, ...dto.metadata };

    // Scope change (only super admin can change scope)
    if (dto.scopeType && dto.scopeType !== post.scopeType) {
      if (!actor.isSuperAdmin) {
        throw new ForbiddenException('Only platform administrators can change blog scope');
      }
      post.scopeType = dto.scopeType;
      post.organizationId = dto.organizationId;
      this.auditService.log({
        organizationId: post.organizationId,
        actorType: 'user',
        actorId: actor.userId,
        action: AuditAction.BLOG_SCOPE_CHANGED,
        resourceType: 'blog_post',
        resourceId: post.id,
        metadata: { newScope: post.scopeType, organizationId: post.organizationId },
      });
    }

    // Status transition
    if (dto.status && dto.status !== post.status) {
      post.status = dto.status;
      if (dto.status === 'PUBLISHED' && !post.publishedAt) {
        post.publishedAt = new Date();
      }
    }

    post.readingTime = dto.readingTime || this.calculateReadingTime(post.content, post.excerpt);
    post.updatedById = actor.userId;
    post.version = (post.version || 1) + 1;
    post.updatedAt = new Date();

    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(BlogPost);
      await repo.save(post);
    }

    this.auditService.log({
      organizationId: post.organizationId,
      actorType: 'user',
      actorId: actor.userId,
      action: AuditAction.BLOG_UPDATED,
      resourceType: 'blog_post',
      resourceId: post.id,
      metadata: { title: post.title, slug: post.slug, status: post.status },
    });

    return this.hydrateBranding(post);
  }

  async publish(
    id: string,
    actor: { userId: string; isSuperAdmin?: boolean },
    organizationIdContext?: string,
  ): Promise<any> {
    const post = dbStore.blogPosts.find((p) => p.id === id && !p.deletedAt);
    if (!post) throw new NotFoundException(`Blog post '${id}' not found`);

    if (post.scopeType === 'GLOBAL' && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only platform administrators can publish global blogs');
    }
    if (organizationIdContext && post.organizationId !== organizationIdContext) {
      throw new ForbiddenException('Cannot publish blog belonging to another organization');
    }

    post.status = 'PUBLISHED';
    post.publishedAt = post.publishedAt || new Date();
    post.updatedById = actor.userId;
    post.updatedAt = new Date();

    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(BlogPost).save(post);
    }

    this.auditService.log({
      organizationId: post.organizationId,
      actorType: 'user',
      actorId: actor.userId,
      action: AuditAction.BLOG_PUBLISHED,
      resourceType: 'blog_post',
      resourceId: post.id,
      metadata: { title: post.title, slug: post.slug },
    });

    return this.hydrateBranding(post);
  }

  async unpublish(
    id: string,
    actor: { userId: string; isSuperAdmin?: boolean },
    organizationIdContext?: string,
  ): Promise<any> {
    const post = dbStore.blogPosts.find((p) => p.id === id && !p.deletedAt);
    if (!post) throw new NotFoundException(`Blog post '${id}' not found`);

    if (post.scopeType === 'GLOBAL' && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only platform administrators can unpublish global blogs');
    }
    if (organizationIdContext && post.organizationId !== organizationIdContext) {
      throw new ForbiddenException('Cannot unpublish blog belonging to another organization');
    }

    post.status = 'DRAFT';
    post.updatedById = actor.userId;
    post.updatedAt = new Date();

    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(BlogPost).save(post);
    }

    this.auditService.log({
      organizationId: post.organizationId,
      actorType: 'user',
      actorId: actor.userId,
      action: AuditAction.BLOG_UNPUBLISHED,
      resourceType: 'blog_post',
      resourceId: post.id,
      metadata: { title: post.title, slug: post.slug },
    });

    return this.hydrateBranding(post);
  }

  async duplicate(
    id: string,
    actor: { userId: string; isSuperAdmin?: boolean },
    organizationIdContext?: string,
  ): Promise<any> {
    const source = dbStore.blogPosts.find((p) => p.id === id && !p.deletedAt);
    if (!source) throw new NotFoundException(`Blog post '${id}' not found`);

    if (source.scopeType === 'GLOBAL' && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only platform administrators can duplicate global blogs');
    }
    if (organizationIdContext && source.organizationId !== organizationIdContext) {
      throw new ForbiddenException('Cannot duplicate blog from another organization');
    }

    const newTitle = `${source.title} (Copy)`;
    const newSlug = await this.ensureUniqueSlug(`${source.slug}-copy`);

    const cloned: BlogPost = {
      id: uuidv4(),
      title: newTitle,
      slug: newSlug,
      excerpt: source.excerpt,
      content: JSON.parse(JSON.stringify(source.content)),
      coverImage: source.coverImage,
      ogImage: source.ogImage,
      category: source.category,
      tags: [...source.tags],
      author: { ...source.author },
      status: 'DRAFT',
      scopeType: source.scopeType,
      organizationId: source.organizationId,
      readingTime: source.readingTime,
      featured: false,
      seoTitle: newTitle,
      seoDescription: source.seoDescription,
      canonicalUrl: `https://affiliate.partneriq.in/blog/${newSlug}`,
      createdById: actor.userId,
      updatedById: actor.userId,
      publishedAt: undefined,
      deletedAt: undefined,
      version: 1,
      metadata: { ...source.metadata, duplicatedFrom: source.id },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(BlogPost).save(AppDataSource.getRepository(BlogPost).create(cloned));
    }

    dbStore.blogPosts.push(cloned);

    this.auditService.log({
      organizationId: cloned.organizationId,
      actorType: 'user',
      actorId: actor.userId,
      action: AuditAction.BLOG_CREATED,
      resourceType: 'blog_post',
      resourceId: cloned.id,
      metadata: { originalId: source.id, duplicatedTitle: cloned.title },
    });

    return this.hydrateBranding(cloned);
  }

  async delete(
    id: string,
    actor: { userId: string; isSuperAdmin?: boolean },
    organizationIdContext?: string,
  ): Promise<{ success: boolean }> {
    const post = dbStore.blogPosts.find((p) => p.id === id && !p.deletedAt);
    if (!post) throw new NotFoundException(`Blog post '${id}' not found`);

    if (post.scopeType === 'GLOBAL' && !actor.isSuperAdmin) {
      throw new ForbiddenException('Only platform administrators can delete global blogs');
    }
    if (organizationIdContext && post.organizationId !== organizationIdContext) {
      throw new ForbiddenException('Cannot delete blog from another organization');
    }

    post.deletedAt = new Date();
    post.updatedById = actor.userId;
    post.updatedAt = new Date();

    if (AppDataSource.isInitialized) {
      await AppDataSource.getRepository(BlogPost).save(post);
    }

    this.auditService.log({
      organizationId: post.organizationId,
      actorType: 'user',
      actorId: actor.userId,
      action: AuditAction.BLOG_DELETED,
      resourceType: 'blog_post',
      resourceId: post.id,
      metadata: { title: post.title, slug: post.slug },
    });

    return { success: true };
  }
}
