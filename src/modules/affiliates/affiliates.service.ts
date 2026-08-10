import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, AffiliateEntity, ProgramAffiliateEntity, AffiliateApplicationEntity, TrackingLinkEntity } from '../../database/store';
import { AffiliateStatus, ApplicationStatus, AuditAction, TrackingLinkStatus } from '../../common/enums';
import { SecurityUtils } from '../../common/utils/security.utils';
import { CreateAffiliateDto, PublicApplyDto } from './dto/affiliate.dto';

@Injectable()
export class AffiliatesService {
  async create(organizationId: string, dto: CreateAffiliateDto, actorId?: string, skipAudit = false) {
    const email = dto.email.toLowerCase().trim();

    let affiliate = dbStore.affiliates.find(
      (a) => a.organizationId === organizationId && a.email === email,
    );

    if (!affiliate) {
      affiliate = {
        id: uuidv4(),
        organizationId,
        displayName: dto.displayName,
        email,
        companyName: dto.companyName,
        website: dto.website,
        country: dto.country || 'US',
        status: AffiliateStatus.ACTIVE,
        trustScore: 80,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.affiliates.push(affiliate);
    }

    // Attach to program
    const referralCode = SecurityUtils.generateRandomCode(6).toLowerCase();
    const progAffiliate: ProgramAffiliateEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      affiliateId: affiliate.id,
      status: AffiliateStatus.ACTIVE,
      referralCode,
      joinedAt: new Date(),
    };

    dbStore.programAffiliates.push(progAffiliate);

    // Auto-create tracking link
    const trackingLink: TrackingLinkEntity = {
      id: uuidv4(),
      organizationId,
      programId: dto.programId,
      affiliateId: affiliate.id,
      destinationUrl: 'https://example.com',
      shortCode: referralCode,
      status: TrackingLinkStatus.ACTIVE,
      createdAt: new Date(),
    };
    dbStore.trackingLinks.push(trackingLink);
    if (!skipAudit) {
      dbStore.auditLogs.push({
        id: uuidv4(),
        organizationId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId || 'system',
        action: 'AFFILIATE_CREATED' as AuditAction,
        resourceType: 'affiliate',
        resourceId: affiliate.id,
        metadata: {
          email: affiliate.email,
          displayName: affiliate.displayName,
          programId: dto.programId,
          programAffiliateId: progAffiliate.id,
          trackingLinkId: trackingLink.id,
        },
        createdAt: new Date(),
      });
    }

    return { affiliate, programAffiliate: progAffiliate, trackingLink };
  }

  async findAll(organizationId: string) {
    return dbStore.affiliates.filter((a) => a.organizationId === organizationId);
  }

  async findOne(organizationId: string, affiliateId: string) {
    const affiliate = dbStore.affiliates.find(
      (a) => a.id === affiliateId && a.organizationId === organizationId,
    );

    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    const programs = dbStore.programAffiliates.filter(
      (pa) => pa.affiliateId === affiliate.id && pa.organizationId === organizationId,
    );

    const links = dbStore.trackingLinks.filter(
      (tl) => tl.affiliateId === affiliate.id && tl.organizationId === organizationId,
    );

    return { ...affiliate, programs, links };
  }

  // Public Application endpoint
  async submitApplication(dto: PublicApplyDto) {
    const app: AffiliateApplicationEntity = {
      id: uuidv4(),
      organizationId: dto.organizationId,
      programId: dto.programId,
      email: dto.email.toLowerCase().trim(),
      name: dto.name,
      website: dto.website,
      promotionMethod: dto.promotionMethod,
      country: 'US',
      status: ApplicationStatus.PENDING,
      createdAt: new Date(),
    };

    dbStore.affiliateApplications.push(app);
    return { success: true, message: 'Application submitted for review', applicationId: app.id };
  }

  async getApplications(organizationId: string) {
    return dbStore.affiliateApplications.filter((a) => a.organizationId === organizationId);
  }

  async approveApplication(organizationId: string, applicationId: string, reviewerId: string) {
    const app = dbStore.affiliateApplications.find(
      (a) => a.id === applicationId && a.organizationId === organizationId,
    );

    if (!app) {
      throw new NotFoundException('Application not found');
    }

    app.status = ApplicationStatus.APPROVED;
    app.reviewedBy = reviewerId;
    app.reviewedAt = new Date();

    // Create affiliate
    const created = await this.create(organizationId, {
      displayName: app.name,
      email: app.email,
      website: app.website,
      programId: app.programId,
    }, reviewerId, true);

    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId: reviewerId,
      action: AuditAction.AFFILIATE_APPROVED,
      resourceType: 'affiliate_application',
      resourceId: app.id,
      createdAt: new Date(),
    });

    return { application: app, ...created };
  }
}
