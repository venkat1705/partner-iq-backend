import { Injectable, Logger } from '@nestjs/common';
import { PageSize, PageOrientation } from '../../../common/enums';

export interface RenderDocumentOptions {
  pageSize?: PageSize | string;
  orientation?: PageOrientation | string;
  margins?: { top: number; right: number; bottom: number; left: number; unit?: string };
  headerHtml?: string;
  footerHtml?: string;
  watermark?: { enabled: boolean; text?: string; opacity?: number; rotation?: number };
  bodyHtml: string;
  data: Record<string, any>;
  brandSettings?: Record<string, any>;
  isTest?: boolean;
}

export interface RenderDocumentResult {
  html: string;
  pageCountEstimate: number;
  data: Record<string, any>;
  renderedAt: string;
  warnings: string[];
}

@Injectable()
export class DocumentRendererService {
  private readonly logger = new Logger(DocumentRendererService.name);

  /**
   * Currency formatter. PartnerIQ processes INR only, platform-wide — this always
   * renders the ₹ symbol regardless of what's passed in, rather than offering a
   * multi-currency symbol table that implies other currencies are supported.
   */
  formatCurrency(value: any): string {
    const num = Number(value);
    if (isNaN(num)) return String(value || '0.00');

    const isNegative = num < 0;
    const absVal = Math.abs(num);

    const formattedNum = absVal.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return isNegative ? `-₹${formattedNum}` : `₹${formattedNum}`;
  }

  /**
   * Safe date formatter
   */
  formatDate(value: any, format = 'date'): string {
    if (!value) return '';
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);

      if (format === 'datetime') {
        return d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      }

      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      });
    } catch {
      return String(value);
    }
  }

  /**
   * Masking formatter for sensitive bank/PII values
   */
  formatMasked(value: any): string {
    if (!value) return '';
    const str = String(value);
    if (str.length <= 4) return '••••';
    return `•••• ${str.slice(-4)}`;
  }

  /**
   * Resolves nested property in context object
   */
  resolvePath(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    if (path === 'this') return obj;

    const parts = path.trim().split('.');
    let curr = obj;
    for (const part of parts) {
      if (curr === null || curr === undefined) return undefined;
      curr = curr[part];
    }
    return curr;
  }

  /**
   * Evaluates formatter expression like:
   * {{summary.totalEarned | currency(statement.currency)}} or {{date | date}}
   */
  applyFormatter(rawVal: any, formatterExpr: string, context: Record<string, any>): string {
    const trimmed = formatterExpr.trim();
    if (!trimmed) return rawVal !== undefined && rawVal !== null ? String(rawVal) : '';

    const match = trimmed.match(/^([a-zA-Z0-9_]+)(?:\((.*)\))?$/);
    if (!match) return rawVal !== undefined && rawVal !== null ? String(rawVal) : '';

    const [, fnName, argsStr] = match;
    const args: string[] = argsStr
      ? argsStr.split(',').map((a) => {
        const s = a.trim();
        if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
          return s.slice(1, -1);
        }
        // evaluate as variable path
        const val = this.resolvePath(context, s);
        return val !== undefined ? String(val) : s;
      })
      : [];

    switch (fnName.toLowerCase()) {
      case 'currency':
        return this.formatCurrency(rawVal);
      case 'date':
        return this.formatDate(rawVal, 'date');
      case 'datetime':
        return this.formatDate(rawVal, 'datetime');
      case 'masked':
        return this.formatMasked(rawVal);
      case 'number':
        return isNaN(Number(rawVal)) ? String(rawVal) : Number(rawVal).toLocaleString('en-US');
      case 'percentage':
        return isNaN(Number(rawVal)) ? String(rawVal) : `${Number(rawVal).toFixed(1)}%`;
      case 'uppercase':
        return String(rawVal || '').toUpperCase();
      case 'lowercase':
        return String(rawVal || '').toLowerCase();
      default:
        return rawVal !== undefined && rawVal !== null ? String(rawVal) : '';
    }
  }

  /**
   * Interpolate variable tag: {{path}} or {{path | formatter(arg)}}
   */
  interpolateTag(tagContent: string, context: Record<string, any>): string {
    const parts = tagContent.split('|');
    const varPath = parts[0].trim();
    const formatterExpr = parts[1] ? parts[1].trim() : '';

    const value = this.resolvePath(context, varPath);
    if (formatterExpr) {
      return this.applyFormatter(value, formatterExpr, context);
    }
    return value !== undefined && value !== null ? String(value) : '';
  }

  /**
   * Processes {{#each array}}...{{/each}} loops
   */
  processEachLoops(templateStr: string, context: Record<string, any>): string {
    const eachRegex = /\{\{#each\s+([a-zA-Z0-9_.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    return templateStr.replace(eachRegex, (_, arrayPath, innerTemplate) => {
      const list = this.resolvePath(context, arrayPath);
      if (!Array.isArray(list) || list.length === 0) {
        return '';
      }

      return list
        .map((item, index) => {
          const itemContext = {
            ...context,
            this: item,
            '@index': index,
            '@first': index === 0,
            '@last': index === list.length - 1,
            ...(typeof item === 'object' && item !== null ? item : {}),
          };
          return this.processTemplate(innerTemplate, itemContext);
        })
        .join('');
    });
  }

  /**
   * Safe conditional parser supporting {{#if condition}}...{{else}}...{{/if}}
   */
  processConditionals(templateStr: string, context: Record<string, any>): string {
    const ifRegex = /\{\{#if\s+(.+?)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
    return templateStr.replace(ifRegex, (_, conditionExpr, ifBlock, elseBlock = '') => {
      let truthy = false;
      const cond = conditionExpr.trim();

      // eq helper: (eq this.status 'APPROVED') or (eq a b)
      const eqMatch = cond.match(/^\(eq\s+([a-zA-Z0-9_.]+)\s+['"]?([^'"]+)['"]?\)$/);
      if (eqMatch) {
        const leftVal = this.resolvePath(context, eqMatch[1]);
        const rightVal = eqMatch[2];
        truthy = String(leftVal).trim() === String(rightVal).trim();
      } else {
        const val = this.resolvePath(context, cond);
        truthy = Boolean(val && val !== 'false' && val !== '0');
      }

      return truthy
        ? this.processTemplate(ifBlock, context)
        : this.processTemplate(elseBlock, context);
    });
  }

  /**
   * Full template string processor (loops, conditions, variables)
   */
  processTemplate(templateStr: string, context: Record<string, any>): string {
    if (!templateStr) return '';
    let result = templateStr;

    // 1. Process loops
    result = this.processEachLoops(result, context);

    // 2. Process conditionals
    result = this.processConditionals(result, context);

    // 3. Process variables
    result = result.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, tag) => {
      if (tag.startsWith('#') || tag.startsWith('/') || tag.startsWith('^') || tag === 'else') {
        return '';
      }
      return this.interpolateTag(tag, context);
    });

    return result;
  }

  /**
   * Compiles the full print-safe HTML layout
   */
  renderDocument(options: RenderDocumentOptions): RenderDocumentResult {
    const warnings: string[] = [];
    const pageSize = (options.pageSize || PageSize.A4).toUpperCase();
    const orientation = (options.orientation || PageOrientation.PORTRAIT).toLowerCase();
    const margins = options.margins || { top: 20, right: 20, bottom: 20, left: 20, unit: 'mm' };

    const mergedData = {
      ...options.data,
      organization: {
        name: options.brandSettings?.name || 'PartnerIQ Technologies',
        supportEmail: options.brandSettings?.supportEmail || 'info@partneriq.in',
        websiteUrl: options.brandSettings?.websiteUrl || 'https://partneriq.in',
        address: options.brandSettings?.physicalAddress || '548 Market St, San Francisco, CA',
        logoUrl: options.brandSettings?.logoUrl,
        ...(options.data?.organization || {}),
      },
      printDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }),
    };

    // Compile Header & Footer
    const headerHtml = options.headerHtml ? this.processTemplate(options.headerHtml, mergedData) : '';
    const footerHtml = options.footerHtml ? this.processTemplate(options.footerHtml, mergedData) : '';
    const bodyContent = this.processTemplate(options.bodyHtml, mergedData);

    const isTest = Boolean(options.isTest);
    const watermarkText = isTest ? 'TEST SAMPLE' : options.watermark?.text;
    const isWatermarkActive = isTest || Boolean(options.watermark?.enabled && watermarkText);
    const watermarkOpacity = isTest ? 0.12 : options.watermark?.opacity || 0.08;
    const watermarkRotation = options.watermark?.rotation !== undefined ? options.watermark.rotation : -35;

    // Build print-safe HTML document
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PartnerIQ Document</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,600;1,700&display=swap" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,600;1,700&display=swap');

    @page {
      size: ${pageSize} ${orientation};
      margin: ${margins.top}${margins.unit || 'mm'} ${margins.right}${margins.unit || 'mm'} ${margins.bottom}${margins.unit || 'mm'} ${margins.left}${margins.unit || 'mm'};
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0F172A;
      background-color: #FFFFFF;
      font-size: 13px;
      line-height: 1.5;
    }

    .document-page-container {
      position: relative;
      width: 100%;
      min-height: 100%;
    }

    .document-header {
      margin-bottom: 20px;
    }

    .document-footer {
      margin-top: 30px;
      page-break-inside: avoid;
    }

    .document-body {
      width: 100%;
    }

    /* Print-Safe Page Breaks */
    .page-break {
      page-break-after: always;
      break-after: page;
      height: 0;
      display: block;
      clear: both;
    }

    .no-break {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    /* Watermark */
    .watermark-overlay {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(${watermarkRotation}deg);
      font-size: 72px;
      font-weight: 900;
      color: #000000;
      opacity: ${watermarkOpacity};
      pointer-events: none;
      z-index: 9999;
      text-transform: uppercase;
      letter-spacing: 6px;
      white-space: nowrap;
      user-select: none;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead {
      display: table-header-group;
    }

    tr {
      page-break-inside: avoid;
    }

    @media screen {
      body {
        background-color: transparent;
        padding: 0;
        margin: 0;
      }

      .document-sheet {
        background-color: #FFFFFF;
        width: 100%;
        min-height: ${pageSize === 'LETTER' ? (orientation === 'landscape' ? '215.9mm' : '279.4mm') : orientation === 'landscape' ? '210mm' : '297mm'};
        padding: ${margins.top}${margins.unit || 'mm'} ${margins.right}${margins.unit || 'mm'} ${margins.bottom}${margins.unit || 'mm'} ${margins.left}${margins.unit || 'mm'};
        margin: 0 auto;
        box-sizing: border-box;
        position: relative;
      }
    }
  </style>
</head>
<body>
  <div class="document-sheet">
    ${isWatermarkActive ? `<div class="watermark-overlay">${watermarkText}</div>` : ''}
    <div class="document-page-container">
      ${headerHtml ? `<header class="document-header">${headerHtml}</header>` : ''}
      <main class="document-body">${bodyContent}</main>
      ${footerHtml ? `<footer class="document-footer">${footerHtml}</footer>` : ''}
    </div>
  </div>
</body>
</html>`;

    // Rough page count estimation based on char length and page breaks
    const pageBreakCount = (bodyContent.match(/class="page-break"/g) || []).length;
    const estimatedPages = Math.max(1, pageBreakCount + Math.ceil(bodyContent.length / 3200));

    return {
      html: fullHtml,
      pageCountEstimate: estimatedPages,
      data: mergedData,
      renderedAt: new Date().toISOString(),
      warnings,
    };
  }
}

