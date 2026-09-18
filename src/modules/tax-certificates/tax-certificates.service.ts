import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { initializeDataSource } from '../../database/data-source';
import { AffiliateTaxCertificate, User } from '../../database/schema';
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

@Injectable()
export class TaxCertificatesService {
  constructor(private readonly auditService?: AuditService) {}

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
    };
  }

  /** Shapes one row for the UI. */
  private present(certificate: AffiliateTaxCertificate, user?: User | null) {
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
  async listAll(filters: { userId?: string; financialYear?: string; status?: string } = {}) {
    const { certificates, users } = await this.repositories();
    const query = certificates.createQueryBuilder('c');
    if (filters.userId) query.andWhere('c.userId = :userId', { userId: filters.userId });
    if (filters.financialYear) query.andWhere('c.financialYear = :fy', { fy: filters.financialYear });
    if (filters.status) query.andWhere('c.status = :status', { status: filters.status });

    const rows = await query.orderBy('c.createdAt', 'DESC').getMany();
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.map((row) => row.userId))];
    const owners = await users.createQueryBuilder('u').where('u.id IN (:...ids)', { ids: userIds }).getMany();
    const byId = new Map(owners.map((owner) => [owner.id, owner]));

    return rows.map((row) => this.present(row, byId.get(row.userId)));
  }

  /**
   * Publishes a certificate to one affiliate. The recipient may be given by id
   * or by email — staff work from an email address far more often than a uuid.
   */
  async publish(input: PublishCertificateInput, publishedByUserId?: string) {
    const { certificates, users } = await this.repositories();

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
    this.audit(AuditAction.TAX_CERTIFICATE_PUBLISHED, saved, publishedByUserId);
    return this.present(saved, owner);
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
      'formType', 'financialYear', 'quarter', 'periodLabel', 'fileUrl', 'fileName',
      'fileSizeBytes', 'grossAmount', 'taxWithheldAmount', 'currency', 'notes',
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
    // Withdrawing a certificate the partner could already see is recorded
    // distinctly from an ordinary metadata edit.
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
