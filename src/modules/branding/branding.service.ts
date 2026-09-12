import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../../database/data-source';
import { dbStore } from '../../database/store';
import { OrganizationBranding, Organization } from '../../database/schema';
import { UpdateBrandingDto } from './dto/branding.dto';

const defaultBranding = {
  primaryColor: '#0284C7',
  secondaryColor: '#06B6D4',
  backgroundColor: '#FFFFFF',
  textColor: '#0F172A',
  heroHeaderPill: 'Partner Program 2026',
  heroTitle: 'Turn your audience into meaningful opportunities.',
  heroDescription:
    'Join our partner ecosystem, discover high-converting programs, and earn predictable recurring commissions with reliable attribution.',
  heroCtaText: 'Become a Partner',
  storyTitle: 'ABOUT OUR PROGRAM',
  storyHeading: 'Build lasting revenue with products customers love.',
  storyDescription:
    'We empower creators, agencies, consultants, and industry leaders with the technology, transparency, and resources needed to grow sustainable referral revenue.',
  mission: 'To foster high-trust partnerships backed by enterprise-grade attribution and prompt payouts.',
  foundedYear: '2022',
  location: 'San Francisco, CA & Remote',
  accreditations: ['SOC2 Type II Certified', 'Enterprise Verified Partner Program', 'GDPR Compliant'],
  trustMetrics: [
    { label: 'Partner Payout Reliability', value: '100% On-Time' },
    { label: 'Average Attribution Window', value: '60 Days' },
    { label: 'Partner Community Rating', value: '4.9 / 5.0' },
  ],
  footerDescription:
    'Official public partner recruitment and affiliate enablement portal powered by PartnerIQ.',
  seoTitle: 'Partner Program | Earn Recurring Referral Commissions',
  seoDescription:
    'Discover partner programs, earn recurring revenue, and collaborate with leading industry solutions.',
  heroHighlightText: '',
  highlightWebsite: false,
  visibility: {
    showPrograms: true,
    showBenefits: true,
    showHowItWorks: true,
    showFaq: true,
    showCompany: true,
    showSocialLinks: true,
    showTrustStrip: true,
  },
};

@Injectable()
export class BrandingService {
  async getBranding(organizationId: string): Promise<any> {
    // 1. Try DB via TypeORM repository
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(OrganizationBranding);
      const existing = await repo.findOne({ where: { organizationId } });
      if (existing) {
        return { ...defaultBranding, ...existing };
      }
    }

    // 2. Try dbStore
    const inStore = dbStore.organizationBrandings.find((b) => b.organizationId === organizationId);
    if (inStore) {
      return { ...defaultBranding, ...inStore };
    }

    // 3. Fall back to organization defaults
    let orgName = 'Partner Program';
    if (AppDataSource.isInitialized) {
      const org = await AppDataSource.getRepository(Organization).findOne({ where: { id: organizationId } });
      if (org?.name) orgName = org.name;
    } else {
      const org = dbStore.organizations.find((o) => o.id === organizationId);
      if (org?.name) orgName = org.name;
    }

    return {
      organizationId,
      ...defaultBranding,
      heroTitle: `Partner with ${orgName}`,
      storyTitle: `ABOUT ${orgName.toUpperCase()}`,
      legalName: `${orgName} Inc.`,
    };
  }

  async updateBranding(organizationId: string, dto: UpdateBrandingDto): Promise<any> {
    let savedResult: any = null;

    // 1. Save directly to DB if initialized
    if (AppDataSource.isInitialized) {
      const repo = AppDataSource.getRepository(OrganizationBranding);
      try {
        let existing = await repo.findOne({ where: { organizationId } });
        if (!existing) {
          existing = repo.create({
            id: uuidv4(),
            organizationId,
            ...dto,
          });
        } else {
          Object.assign(existing, dto);
        }
        savedResult = await repo.save(existing);
      } catch (err: any) {
        // If MySQL table had older schema with smaller column (e.g. VARCHAR(255) for logoUrl or TEXT):
        if (err?.message?.includes('Data too long') || err?.code === 'ER_DATA_TOO_LONG') {
          try {
            await AppDataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN logoUrl MEDIUMTEXT NULL`);
            await AppDataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN logoDarkUrl MEDIUMTEXT NULL`);
            await AppDataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN faviconUrl MEDIUMTEXT NULL`);
            await AppDataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN heroImageUrl MEDIUMTEXT NULL`);
            await AppDataSource.query(`ALTER TABLE organization_brandings MODIFY COLUMN seoImageUrl MEDIUMTEXT NULL`);
            // Retry save
            let existing = await repo.findOne({ where: { organizationId } });
            if (!existing) {
              existing = repo.create({
                id: uuidv4(),
                organizationId,
                ...dto,
              });
            } else {
              Object.assign(existing, dto);
            }
            savedResult = await repo.save(existing);
          } catch (retryErr) {
            throw retryErr;
          }
        } else {
          throw err;
        }
      }
    }

    // 2. Synchronize in-memory dbStore
    const storeIdx = dbStore.organizationBrandings.findIndex((b) => b.organizationId === organizationId);
    if (storeIdx >= 0) {
      dbStore.organizationBrandings[storeIdx] = {
        ...dbStore.organizationBrandings[storeIdx],
        ...dto,
        organizationId,
        updatedAt: new Date(),
      };
      if (!savedResult) savedResult = dbStore.organizationBrandings[storeIdx];
    } else {
      const newEntity: any = {
        id: savedResult?.id || uuidv4(),
        organizationId,
        ...defaultBranding,
        ...dto,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.organizationBrandings.push(newEntity);
      if (!savedResult) savedResult = newEntity;
    }

    return savedResult;
  }

  async getPublicBranding(slugOrSubdomain: string): Promise<any> {
    let org: any = null;
    const cleanParam = (slugOrSubdomain || '').toLowerCase().trim();

    if (AppDataSource.isInitialized) {
      const orgRepo = AppDataSource.getRepository(Organization);
      org = await orgRepo.findOne({
        where: [
          { slug: cleanParam },
          { id: slugOrSubdomain },
        ],
      });
      if (!org) {
        const all = await orgRepo.find();
        org = all.find(
          (o) =>
            (o.slug && o.slug.toLowerCase() === cleanParam) ||
            (o.name && o.name.toLowerCase().replace(/\s+/g, '-') === cleanParam) ||
            o.id === slugOrSubdomain
        );
      }
    } else {
      org = dbStore.organizations.find(
        (o) =>
          (o.slug && o.slug.toLowerCase() === cleanParam) ||
          (o.name && o.name.toLowerCase().replace(/\s+/g, '-') === cleanParam) ||
          o.id === slugOrSubdomain
      );
    }

    if (org) {
      const branding = await this.getBranding(org.id);
      return {
        ...branding,
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug || cleanParam,
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug || cleanParam,
          subdomain: org.slug || cleanParam,
          websiteUrl: org.website || '',
          category: (org as any).category || (org as any).industry || 'SaaS',
        },
      };
    }

    return {
      slug: slugOrSubdomain,
      ...defaultBranding,
      organizationName: slugOrSubdomain ? slugOrSubdomain.charAt(0).toUpperCase() + slugOrSubdomain.slice(1) : 'Partner Program',
      organizationSlug: slugOrSubdomain || 'partner',
    };
  }
}
