import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../../database/store';
import { GeneratedDocument } from '../../../database/schema';
import { DocumentType, DocumentStatus } from '../../../common/enums';
import { DocumentRendererService, RenderDocumentOptions } from './document-renderer.service';

export interface GeneratePdfOptions {
  templateKey: string;
  templateVersionId?: string;
  documentType?: DocumentType;
  documentNumber?: string;
  referenceId?: string;
  organizationId?: string;
  recipientName?: string;
  recipientEmail?: string;
  renderOptions: RenderDocumentOptions;
  isTest?: boolean;
  generatedById?: string;
}

@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);

  constructor(private readonly renderer: DocumentRendererService) { }

  /**
   * Sanitizes string to be safe for filenames across OSes
   */
  sanitizeFileName(str: string): string {
    return str
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .trim();
  }

  /**
   * Generates a deterministic document file name
   */
  buildFileName(params: {
    orgName?: string;
    documentType?: string;
    recipientName?: string;
    documentNumber?: string;
    isTest?: boolean;
  }): string {
    const orgPart = this.sanitizeFileName(params.orgName || 'PartnerIQ');
    const typePart = this.sanitizeFileName(params.documentType || 'Document');
    const recipientPart = params.recipientName ? this.sanitizeFileName(params.recipientName) : '';
    const numPart = params.documentNumber ? this.sanitizeFileName(params.documentNumber) : '';
    const testPrefix = params.isTest ? 'TEST_' : '';

    const parts = [testPrefix + orgPart, typePart, recipientPart, numPart].filter(Boolean);
    return `${parts.join('_')}.pdf`;
  }

  /**
   * Generates a document snapshot and records it in database store
   */
  async generateAndRecordDocument(options: GeneratePdfOptions): Promise<GeneratedDocument> {
    this.logger.log(`Generating PDF document for template [${options.templateKey}] (${options.documentType || 'DOCUMENT'})`);

    const renderResult = this.renderer.renderDocument({
      ...options.renderOptions,
      isTest: options.isTest,
    });

    const orgName = options.renderOptions.brandSettings?.name || options.renderOptions.data?.organization?.name || 'PartnerIQ';
    const recipientName = options.recipientName || options.renderOptions.data?.affiliate?.name || options.renderOptions.data?.client?.name || '';
    const docNumber = options.documentNumber || options.renderOptions.data?.statement?.number || options.renderOptions.data?.invoice?.number || options.renderOptions.data?.payout?.reference || '';

    const fileName = this.buildFileName({
      orgName,
      documentType: options.documentType || DocumentType.CUSTOM,
      recipientName,
      documentNumber: docNumber,
      isTest: options.isTest,
    });

    // Approximate size based on HTML snapshot length * PDF rendering factor
    const approximateBytes = Math.round(renderResult.html.length * 1.8) + 15000;

    const record: GeneratedDocument = {
      id: uuidv4(),
      templateKey: options.templateKey,
      templateVersionId: options.templateVersionId,
      documentType: options.documentType || DocumentType.CUSTOM,
      documentNumber: docNumber || undefined,
      referenceId: options.referenceId,
      organizationId: options.organizationId,
      recipientName: recipientName || undefined,
      recipientEmail: options.recipientEmail || options.renderOptions.data?.affiliate?.email || options.renderOptions.data?.client?.email,
      status: DocumentStatus.GENERATED,
      renderedHtmlSnapshot: renderResult.html,
      pdfUrl: `/api/v1/admin/email-design/documents/generated/preview-html?docId=${encodeURIComponent(options.templateKey)}`,
      fileName,
      fileSizeBytes: approximateBytes,
      metadata: {
        pageCountEstimate: renderResult.pageCountEstimate,
        isTest: Boolean(options.isTest),
        generatedAt: renderResult.renderedAt,
      },
      generatedAt: new Date(),
      generatedById: options.generatedById,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dbStore.generatedDocuments.unshift(record);
    return record;
  }

  /**
   * Retrieves generated document by ID
   */
  getDocumentById(id: string): GeneratedDocument {
    const doc = dbStore.generatedDocuments.find((d) => d.id === id);
    if (!doc) {
      throw new NotFoundException(`Generated document with ID [${id}] not found`);
    }
    return doc;
  }

  /**
   * Lists generated documents with search and filter queries
   */
  listGeneratedDocuments(filter: {
    search?: string;
    documentType?: string;
    status?: string;
    organizationId?: string;
    page?: number;
    limit?: number;
  }) {
    let docs = dbStore.generatedDocuments.slice();

    if (filter.organizationId) {
      docs = docs.filter((d) => !d.organizationId || d.organizationId === filter.organizationId);
    }

    if (filter.documentType && filter.documentType !== 'ALL') {
      docs = docs.filter((d) => d.documentType === filter.documentType);
    }

    if (filter.status && filter.status !== 'ALL') {
      docs = docs.filter((d) => d.status === filter.status);
    }

    if (filter.search) {
      const q = filter.search.toLowerCase();
      docs = docs.filter(
        (d) =>
          d.fileName.toLowerCase().includes(q) ||
          (d.documentNumber && d.documentNumber.toLowerCase().includes(q)) ||
          (d.recipientName && d.recipientName.toLowerCase().includes(q)) ||
          (d.recipientEmail && d.recipientEmail.toLowerCase().includes(q)) ||
          d.templateKey.toLowerCase().includes(q),
      );
    }

    // Sort newest first
    docs.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const total = docs.length;
    const pages = Math.ceil(total / limit) || 1;
    const paginated = docs.slice((page - 1) * limit, page * limit);

    return {
      documents: paginated,
      pagination: { page, limit, total, pages },
    };
  }
}

