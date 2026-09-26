import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { initializeDataSource } from '../../database/data-source';
import { AffiliateTaxCertificate, AffiliatePortalProfile, User } from '../../database/schema';
import { AuditAction } from '../../common/enums';
import { AuditService } from '../audit/audit.service';

export interface PublishCertificateInput {
  userId?: string;
  email?: string;
  organizationId?: string;
  formType?: string;
  financialYear: string;
  quarter?: string;
  periodLabel?: string;
  fileUrl: string;
  fileName?: string;
  fileSizeBytes?: number;
  grossAmount?: number;
  taxWithheldAmount?: number;
  currency?: string;
  notes?: string;
  status?: 'DRAFT' | 'PUBLISHED';
}

export function maskTaxId(taxId?: string | null): string {
  if (!taxId) return 'NOT_PROVIDED';
  const clean = taxId.trim();
  if (clean.length <= 4) return '••••' + clean;
  return '••••••••' + clean.slice(-4);
}

export function inferJurisdiction(formType: string, taxCountry?: string): string {
  if (formType.startsWith('FORM_16') || formType.includes('PAN') || formType.includes('GST')) return 'IN';
  if (formType.includes('1099') || formType.includes('W8') || formType.includes('W9')) return 'US';
  if (formType.includes('VAT') || formType.includes('UTR')) return 'GB';
  if (taxCountry) {
    const c = taxCountry.toLowerCase();
    if (c.includes('india')) return 'IN';
    if (c.includes('united states') || c === 'us' || c === 'usa') return 'US';
    if (c.includes('kingdom') || c === 'uk' || c === 'gb') return 'GB';
    if (c.includes('canada') || c === 'ca') return 'CA';
    if (c.includes('australia') || c === 'au') return 'AU';
    if (c.includes('singapore') || c === 'sg') return 'SG';
    if (c.includes('emirates') || c === 'uae' || c === 'ae') return 'AE';
  }
  return 'IN';
}

@Injectable()
export class TaxCertificatesService {
  constructor(private readonly auditService?: AuditService) { }

  /**
   * Issuing, amending, withdrawing and deleting a tax certificate are all
   * statutory acts, so each one leaves a record naming the actor and the
   * affiliate it affected. Logging never blocks the operation itself.
   */
  private audit(
    action: AuditAction,
    certificate: AffiliateTaxCertificate,
    actorId?: string,
    metadata: Record<string, unknown> = {},
  ) {
    try {
      this.auditService?.log({
        organizationId: certificate.organizationId,
        actorType: actorId ? 'user' : 'system',
        actorId: actorId || 'system',
        action,
        resourceType: 'affiliate_tax_certificate',
        resourceId: certificate.id,
        metadata: {
          affiliateUserId: certificate.userId,
          financialYear: certificate.financialYear,
          formType: certificate.formType,
          status: certificate.status,
          ...metadata,
        },
      });
    } catch {
      // An audit sink failure must not lose the certificate that was just filed.
    }
  }

  private async repositories() {
    const dataSource = await initializeDataSource();
    return {
      certificates: dataSource.getRepository(AffiliateTaxCertificate),
      users: dataSource.getRepository(User),
      profiles: dataSource.getRepository(AffiliatePortalProfile),
    };
  }

  /** Shapes one row for the UI with enterprise compliance fields. */
  private present(
    certificate: AffiliateTaxCertificate,
    user?: User | null,
    profile?: AffiliatePortalProfile | null,
  ) {
    const jurisdiction = inferJurisdiction(certificate.formType, profile?.taxCountry);
    const maskedTaxId = maskTaxId(profile?.panOrTaxId);
    const verificationStatus =
      certificate.status === 'PUBLISHED'
        ? 'VERIFIED'
        : certificate.status === 'REVOKED'
          ? 'REJECTED'
          : 'PENDING';
    const complianceStatus =
      certificate.status === 'PUBLISHED'
        ? 'COMPLIANT'
        : certificate.status === 'REVOKED'
          ? 'ACTION_REQUIRED'
          : 'PENDING_REVIEW';

    // Calculate approximate expiration date (1 year after creation date or FY end)
    const issueDate = new Date(certificate.createdAt);
    const expiresAt = new Date(issueDate.getTime() + 365 * 24 * 3600 * 1000).toISOString();

    return {
      id: certificate.id,
      userId: certificate.userId,
      affiliateEmail: user?.email,
      affiliateName: user ? `${user.firstName} ${user.lastName}`.trim() : undefined,
      organizationId: certificate.organizationId,
      formType: certificate.formType,
      financialYear: certificate.financialYear,
      quarter: certificate.quarter,
      periodLabel: certificate.periodLabel,
      fileUrl: certificate.fileUrl,
      fileName: certificate.fileName,
      fileSizeBytes: Number(certificate.fileSizeBytes || 0),
      grossAmount: Number(certificate.grossAmount || 0),
      taxWithheldAmount: Number(certificate.taxWithheldAmount || 0),
      currency: certificate.currency,
      status: certificate.status,
      publishedAt: certificate.publishedAt,
      notes: certificate.notes,
      createdAt: certificate.createdAt,
      jurisdiction,
      maskedTaxId,
      taxClassification: profile?.taxClassification || 'INDIVIDUAL',
      taxResidency: profile?.taxCountry || profile?.country || 'India',
      verificationStatus,
      complianceStatus,
      version: 'v1.0',
      issuedAt: certificate.publishedAt || certificate.createdAt,
      expiresAt,
    };
  }

  /**
   * The affiliate's own certificates. Drafts and revoked rows are withheld — a
   * partner should only ever see what has actually been issued to them.
   */
  async listForAffiliate(userId: string) {
    const { certificates } = await this.repositories();
    const rows = await certificates.find({
      where: { userId, status: 'PUBLISHED' },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.present(row));
  }

  /** Every certificate across the platform, newest first, for staff. */
  async listAll(filters: { userId?: string; financialYear?: string; status?: string; jurisdiction?: string } = {}) {
    const { certificates, users, profiles } = await this.repositories();
    const query = certificates.createQueryBuilder('c');
    if (filters.userId) query.andWhere('c.userId = :userId', { userId: filters.userId });
    if (filters.financialYear) query.andWhere('c.financialYear = :fy', { fy: filters.financialYear });
    if (filters.status && filters.status !== 'ALL') query.andWhere('c.status = :status', { status: filters.status });

    const rows = await query.orderBy('c.createdAt', 'DESC').getMany();
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.map((row) => row.userId))];
    const [owners, allProfiles] = await Promise.all([
      users.createQueryBuilder('u').where('u.id IN (:...ids)', { ids: userIds }).getMany(),
      profiles.createQueryBuilder('p').where('p.userId IN (:...ids)', { ids: userIds }).getMany(),
    ]);

    const userById = new Map(owners.map((owner) => [owner.id, owner]));
    const profileByUserId = new Map(allProfiles.map((p) => [p.userId, p]));

    let results = rows.map((row) =>
      this.present(row, userById.get(row.userId), profileByUserId.get(row.userId)),
    );

    if (filters.jurisdiction && filters.jurisdiction !== 'ALL') {
      results = results.filter((r) => r.jurisdiction === filters.jurisdiction);
    }

    return results;
  }

  /**
   * Returns calculated real-time KPIs and breakdown for the Tax & Compliance Center.
   */
  async getAnalytics(jurisdiction?: string) {
    const { certificates, profiles, users } = await this.repositories();

    const [allCerts, allProfiles, totalUsers] = await Promise.all([
      certificates.find(),
      profiles.find(),
      users.count({ where: { deletedAt: IsNull() } }),
    ]);

    let filteredCerts = allCerts;
    let filteredProfiles = allProfiles;

    if (jurisdiction && jurisdiction !== 'ALL') {
      filteredCerts = allCerts.filter((c) => inferJurisdiction(c.formType) === jurisdiction);
      filteredProfiles = allProfiles.filter((p) => {
        const c = (p.taxCountry || p.country || '').toLowerCase();
        if (jurisdiction === 'IN' && (c.includes('india') || !c)) return true;
        if (jurisdiction === 'US' && (c.includes('united states') || c === 'us')) return true;
        if (jurisdiction === 'GB' && (c.includes('kingdom') || c === 'uk')) return true;
        return false;
      });
    }

    const totalProfilesCount = Math.max(filteredProfiles.length, totalUsers);
    const verifiedProfiles = filteredProfiles.filter((p) => p.taxVerified).length;
    const pendingVerification = filteredProfiles.filter((p) => !p.taxVerified && p.taxSubmittedAt).length;
    const missingDocuments = Math.max(0, totalProfilesCount - filteredCerts.length);

    const now = Date.now();
    let expiringSoon = 0;
    let expired = 0;

    filteredCerts.forEach((c) => {
      const issueTime = new Date(c.createdAt).getTime();
      const expiryTime = issueTime + 365 * 24 * 3600 * 1000;
      const daysLeft = (expiryTime - now) / (24 * 3600 * 1000);
      if (c.status === 'REVOKED' || daysLeft < 0) {
        expired += 1;
      } else if (daysLeft <= 90) {
        expiringSoon += 1;
      }
    });

    const complianceExceptions = pendingVerification + missingDocuments + expired;

    const publishedCerts = filteredCerts.filter((c) => c.status === 'PUBLISHED').length;
    const draftCerts = filteredCerts.filter((c) => c.status === 'DRAFT').length;
    const revokedCerts = filteredCerts.filter((c) => c.status === 'REVOKED').length;

    // Monthly submission trend (last 6 months)
    const trendMap = new Map<string, { submitted: number; verified: number; rejected: number }>();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`;
      trendMap.set(key, { submitted: 0, verified: 0, rejected: 0 });
    }

    filteredCerts.forEach((c) => {
      const d = new Date(c.createdAt);
      const key = `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`;
      if (trendMap.has(key)) {
        const item = trendMap.get(key)!;
        item.submitted += 1;
        if (c.status === 'PUBLISHED') item.verified += 1;
        if (c.status === 'REVOKED') item.rejected += 1;
      }
    });

    const trend = Array.from(trendMap.entries()).map(([period, data]) => ({
      period,
      submitted: data.submitted,
      verified: data.verified,
      rejected: data.rejected,
    }));

    return {
      totalProfiles: totalProfilesCount,
      verifiedProfiles,
      pendingVerification,
      missingDocuments,
      expiringSoon,
      expired,
      complianceExceptions,
      configuredJurisdictions: 8,
      statusBreakdown: {
        verified: publishedCerts || verifiedProfiles,
        pending: draftCerts || pendingVerification,
        missing: missingDocuments,
        expired,
        rejected: revokedCerts,
      },
      trend,
    };
  }

  /**
   * Returns structured entity tax profiles with residency, masked tax IDs, and withholding rates.
   */
  async listProfiles(filters: { jurisdiction?: string; status?: string } = {}) {
    const { profiles, users, certificates } = await this.repositories();

    const [allProfiles, allUsers, allCerts] = await Promise.all([
      profiles.find(),
      users.find({ where: { deletedAt: IsNull() } }),
      certificates.find(),
    ]);

    const certsCountByUserId = new Map<string, number>();
    allCerts.forEach((c) => {
      certsCountByUserId.set(c.userId, (certsCountByUserId.get(c.userId) || 0) + 1);
    });

    const profileByUserId = new Map(allProfiles.map((p) => [p.userId, p]));

    let results = allUsers.map((user) => {
      const profile = profileByUserId.get(user.id);
      const jurisdiction = inferJurisdiction('PAN_TDS', profile?.taxCountry);
      const maskedTaxId = maskTaxId(profile?.panOrTaxId);
      const isVerified = Boolean(profile?.taxVerified);
      const documentsCount = certsCountByUserId.get(user.id) || 0;

      let complianceStatus: 'COMPLIANT' | 'ACTION_REQUIRED' | 'PENDING_REVIEW' = 'PENDING_REVIEW';
      if (isVerified && documentsCount > 0) {
        complianceStatus = 'COMPLIANT';
      } else if (!isVerified && profile?.taxSubmittedAt) {
        complianceStatus = 'PENDING_REVIEW';
      } else {
        complianceStatus = 'ACTION_REQUIRED';
      }

      return {
        id: profile?.id || user.id,
        userId: user.id,
        legalName: profile?.fullName || `${user.firstName} ${user.lastName}`.trim() || 'Partner Legal Entity',
        email: user.email,
        entityType: profile?.partnerType || 'AFFILIATE',
        country: profile?.country || 'India',
        taxCountry: profile?.taxCountry || 'India',
        jurisdiction,
        taxClassification: profile?.taxClassification || 'INDIVIDUAL',
        panOrTaxId: maskedTaxId,
        withholdingRate: profile?.withholdingRate ?? 0,
        taxVerified: isVerified,
        taxFormType: profile?.taxFormType || 'PAN_TDS',
        taxSubmittedAt: profile?.taxSubmittedAt?.toISOString?.() || undefined,
        complianceStatus,
        documentsCount,
      };
    });

    if (filters.jurisdiction && filters.jurisdiction !== 'ALL') {
      results = results.filter((p) => p.jurisdiction === filters.jurisdiction);
    }
    if (filters.status && filters.status !== 'ALL') {
      results = results.filter((p) => p.complianceStatus === filters.status);
    }

    return results;
  }

  /**
   * Verifies an uploaded or published tax document.
   */
  async verifyDocument(id: string, reviewerId?: string, method = 'Manual Statutory Review', notes?: string) {
    const { certificates, profiles } = await this.repositories();
    const certificate = await certificates.findOne({ where: { id } });
    if (!certificate) throw new NotFoundException('Tax document not found.');

    certificate.status = 'PUBLISHED';
    certificate.publishedAt = certificate.publishedAt || new Date();
    if (notes) certificate.notes = (certificate.notes ? certificate.notes + '\n' : '') + `[Verified by Admin]: ${notes}`;

    const saved = await certificates.save(certificate);

    // Also mark affiliate profile as verified
    const profile = await profiles.findOne({ where: { userId: certificate.userId } });
    if (profile) {
      profile.taxVerified = true;
      await profiles.save(profile);
    }

    this.audit(AuditAction.TAX_CERTIFICATE_UPDATED, saved, reviewerId, {
      verificationAction: 'VERIFIED',
      method,
      notes,
    });

    return this.present(saved);
  }

  /**
   * Rejects a tax document with actionable reason and required correction.
   */
  async rejectDocument(
    id: string,
    reviewerId?: string,
    reason = 'Tax identifier does not match declared legal entity name',
    requiredCorrection = 'Please re-upload a valid tax certificate with matching details',
    notes?: string,
  ) {
    const { certificates, profiles } = await this.repositories();
    const certificate = await certificates.findOne({ where: { id } });
    if (!certificate) throw new NotFoundException('Tax document not found.');

    certificate.status = 'REVOKED';
    const rejectionNote = `[Rejected]: ${reason}. Action needed: ${requiredCorrection}${notes ? ' - ' + notes : ''}`;
    certificate.notes = certificate.notes ? `${certificate.notes}\n${rejectionNote}` : rejectionNote;

    const saved = await certificates.save(certificate);

    const profile = await profiles.findOne({ where: { userId: certificate.userId } });
    if (profile) {
      profile.taxVerified = false;
      await profiles.save(profile);
    }

    this.audit(AuditAction.TAX_CERTIFICATE_UNPUBLISHED, saved, reviewerId, {
      rejectionReason: reason,
      requiredCorrection,
      notes,
    });

    return this.present(saved);
  }

  /**
   * Returns normalized multi-market jurisdiction specifications.
   */
  listJurisdictions() {
    return [
      {
        code: 'IN',
        name: 'India',
        region: 'South Asia',
        taxAuthority: 'Income Tax Department / GSTN',
        supportedIdentifiers: ['PAN (Permanent Account Number)', 'GSTIN (GST Identification)', 'TAN'],
        documentTypes: ['Form 16A (TDS Certificate)', 'GST Tax Invoice', 'PAN Card Verification'],
        defaultWithholdingRate: '10% (Section 194H/194-O) / 1% TDS',
        status: 'ACTIVE',
        isDefault: true,
      },
      {
        code: 'US',
        name: 'United States',
        region: 'North America',
        taxAuthority: 'Internal Revenue Service (IRS)',
        supportedIdentifiers: ['SSN', 'EIN (Employer Identification)', 'ITIN'],
        documentTypes: ['Form W-9 (US Persons)', 'Form W-8BEN (Foreign Individuals)', 'Form 1099-NEC'],
        defaultWithholdingRate: '0% (With valid W-9) / 30% (Foreign fallback)',
        status: 'READY_FOR_EXPANSION',
        isDefault: false,
      },
      {
        code: 'GB',
        name: 'United Kingdom',
        region: 'Europe',
        taxAuthority: 'HM Revenue & Customs (HMRC)',
        supportedIdentifiers: ['UTR (Unique Taxpayer Reference)', 'VAT Registration Number', 'CRN'],
        documentTypes: ['VAT Commercial Invoice', 'Certificate of Tax Residence'],
        defaultWithholdingRate: '0% (Standard reverse-charge VAT)',
        status: 'READY_FOR_EXPANSION',
        isDefault: false,
      },
      {
        code: 'EU',
        name: 'European Union',
        region: 'Europe',
        taxAuthority: 'Member State Tax Authorities / VIES',
        supportedIdentifiers: ['EU VAT ID', 'National Tax Identification Number (TIN)'],
        documentTypes: ['Intra-Community VAT Invoice', 'Tax Residency Certificate'],
        defaultWithholdingRate: '0% (B2B Cross-Border Reverse Charge)',
        status: 'READY_FOR_EXPANSION',
        isDefault: false,
      },
      {
        code: 'CA',
        name: 'Canada',
        region: 'North America',
        taxAuthority: 'Canada Revenue Agency (CRA)',
        supportedIdentifiers: ['SIN (Social Insurance Number)', 'BN (Business Number)', 'GST/HST Number'],
        documentTypes: ['T4A-NR Statement of Fees Paid', 'Form NR301 Declaration of Eligibility'],
        defaultWithholdingRate: '15% (Regulation 105 Withholding)',
        status: 'READY_FOR_EXPANSION',
        isDefault: false,
      },
      {
        code: 'AU',
        name: 'Australia',
        region: 'Asia-Pacific',
        taxAuthority: 'Australian Taxation Office (ATO)',
        supportedIdentifiers: ['TFN (Tax File Number)', 'ABN (Australian Business Number)'],
        documentTypes: ['Withholding Declaration', 'Tax Invoice (GST compliant)'],
        defaultWithholdingRate: '47% (No-ABN withholding) / 0% (With valid ABN)',
        status: 'READY_FOR_EXPANSION',
        isDefault: false,
      },
      {
        code: 'SG',
        name: 'Singapore',
        region: 'Southeast Asia',
        taxAuthority: 'Inland Revenue Authority of Singapore (IRAS)',
        supportedIdentifiers: ['NRIC / FIN', 'UEN (Unique Entity Number)', 'GST Reg No'],
        documentTypes: ['Certificate of Residence', 'Section 45 Withholding Form'],
        defaultWithholdingRate: '10% (Section 45 Non-Resident)',
        status: 'READY_FOR_EXPANSION',
        isDefault: false,
      },
      {
        code: 'AE',
        name: 'United Arab Emirates',
        region: 'Middle East',
        taxAuthority: 'Federal Tax Authority (FTA)',
        supportedIdentifiers: ['TRN (Tax Registration Number)', 'Corporate Tax Number'],
        documentTypes: ['Tax Residency Certificate', 'FTA VAT Return / Invoice'],
        defaultWithholdingRate: '0% (Standard WHT rate)',
        status: 'READY_FOR_EXPANSION',
        isDefault: false,
      },
    ];
  }

  /**
   * Returns registered compliance document and certificate templates.
   */
  listTemplates() {
    return [
      {
        id: 'TPL-IN-16A',
        code: 'FORM_16A',
        name: 'Form 16A — Quarterly TDS Certificate',
        jurisdiction: 'IN',
        applicableEntityTypes: ['INDIVIDUAL', 'COMPANY', 'PARTNERSHIP'],
        version: 'v2026.1',
        description: 'Quarterly tax deducted at source statement under Section 203 of the Income-tax Act, 1961.',
        status: 'ACTIVE',
      },
      {
        id: 'TPL-US-1099',
        code: 'FORM_1099',
        name: 'Form 1099-NEC — Nonemployee Compensation',
        jurisdiction: 'US',
        applicableEntityTypes: ['INDIVIDUAL', 'LLC', 'CORPORATION'],
        version: 'v2026.1',
        description: 'Annual nonemployee payment reporting filed with the IRS for US payees exceeding $600.',
        status: 'ACTIVE',
      },
      {
        id: 'TPL-US-W8BEN',
        code: 'W8_BEN',
        name: 'Form W-8BEN — Certificate of Foreign Status',
        jurisdiction: 'US',
        applicableEntityTypes: ['INDIVIDUAL'],
        version: 'v2025.2',
        description: 'Withholding exemption certification for non-resident alien individuals claiming tax treaty benefits.',
        status: 'ACTIVE',
      },
      {
        id: 'TPL-GB-VAT',
        code: 'VAT_INVOICE',
        name: 'HMRC Compliant VAT Tax Invoice',
        jurisdiction: 'GB',
        applicableEntityTypes: ['COMPANY', 'SOLE_TRADER'],
        version: 'v2026.1',
        description: 'Full UK VAT breakdown with UTR and reverse-charge declaration.',
        status: 'ACTIVE',
      },
      {
        id: 'TPL-IN-GST',
        code: 'GST_INVOICE',
        name: 'GST Tax Invoice & Supply Certificate',
        jurisdiction: 'IN',
        applicableEntityTypes: ['COMPANY', 'PROPRIETORSHIP'],
        version: 'v2026.1',
        description: 'Standard B2B tax invoice with SAC codes, CGST/SGST/IGST breakdown, and HSN identification.',
        status: 'ACTIVE',
      },
    ];
  }

  /**
   * Publishes a certificate to one affiliate. The recipient may be given by id
   * or by email — staff work from an email address far more often than a uuid.
   */
  async publish(input: PublishCertificateInput, publishedByUserId?: string) {
    const { certificates, users, profiles } = await this.repositories();

    let owner: User | null = null;
    if (input.userId) {
      owner = await users.findOne({ where: { id: input.userId, deletedAt: IsNull() } });
    } else if (input.email) {
      owner = await users.findOne({ where: { email: input.email.toLowerCase().trim(), deletedAt: IsNull() } });
    }
    if (!owner) {
      throw new NotFoundException('No affiliate account matches that recipient.');
    }
    if (!input.fileUrl) {
      throw new BadRequestException('A certificate file URL is required.');
    }
    if (!input.financialYear) {
      throw new BadRequestException('A financial year is required.');
    }

    const status = input.status || 'PUBLISHED';
    const periodLabel =
      input.periodLabel ||
      (input.quarter ? `${input.quarter} ${input.financialYear}` : input.financialYear);

    const certificate = certificates.create({
      userId: owner.id,
      organizationId: input.organizationId,
      formType: input.formType || 'FORM_16A',
      financialYear: input.financialYear,
      quarter: input.quarter,
      periodLabel,
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes || 0,
      grossAmount: input.grossAmount || 0,
      taxWithheldAmount: input.taxWithheldAmount || 0,
      currency: input.currency || 'INR',
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
      publishedByUserId,
      notes: input.notes,
    });

    const saved = await certificates.save(certificate);

    const profile = await profiles.findOne({ where: { userId: owner.id } });
    if (profile && status === 'PUBLISHED') {
      profile.taxVerified = true;
      await profiles.save(profile);
    }

    this.audit(AuditAction.TAX_CERTIFICATE_PUBLISHED, saved, publishedByUserId);
    return this.present(saved, owner, profile);
  }

  async update(
    id: string,
    updates: Partial<PublishCertificateInput> & { status?: 'DRAFT' | 'PUBLISHED' | 'REVOKED' },
    actorUserId?: string,
  ) {
    const { certificates } = await this.repositories();
    const certificate = await certificates.findOne({ where: { id } });
    if (!certificate) throw new NotFoundException('Certificate not found.');

    const wasPublished = certificate.status === 'PUBLISHED';
    const assignable: (keyof PublishCertificateInput)[] = [
      'formType',
      'financialYear',
      'quarter',
      'periodLabel',
      'fileUrl',
      'fileName',
      'fileSizeBytes',
      'grossAmount',
      'taxWithheldAmount',
      'currency',
      'notes',
    ];
    for (const key of assignable) {
      if (updates[key] !== undefined) (certificate as any)[key] = updates[key];
    }
    if (updates.status !== undefined) certificate.status = updates.status;

    // Publishing for the first time stamps the date the partner sees.
    if (!wasPublished && certificate.status === 'PUBLISHED' && !certificate.publishedAt) {
      certificate.publishedAt = new Date();
    }

    const saved = await certificates.save(certificate);
    const wasWithdrawn = wasPublished && saved.status !== 'PUBLISHED';
    this.audit(
      wasWithdrawn ? AuditAction.TAX_CERTIFICATE_UNPUBLISHED : AuditAction.TAX_CERTIFICATE_UPDATED,
      saved,
      actorUserId,
      { previousStatus: wasPublished ? 'PUBLISHED' : certificate.status },
    );
    return this.present(saved);
  }

  async remove(id: string, actorUserId?: string) {
    const { certificates } = await this.repositories();
    const certificate = await certificates.findOne({ where: { id } });
    if (!certificate) throw new NotFoundException('Certificate not found.');
    await certificates.delete({ id });
    this.audit(AuditAction.TAX_CERTIFICATE_DELETED, certificate, actorUserId);
    return { success: true, id };
  }

  /** Verifies the certificate belongs to this affiliate before handing back its URL. */
  async getDownloadUrl(id: string, userId: string) {
    const { certificates } = await this.repositories();
    const certificate = await certificates.findOne({ where: { id, userId, status: 'PUBLISHED' } });
    if (!certificate) throw new NotFoundException('Certificate not found.');
    this.audit(AuditAction.TAX_CERTIFICATE_DOWNLOADED, certificate, userId);
    return { url: certificate.fileUrl, fileName: certificate.fileName };
  }
}
