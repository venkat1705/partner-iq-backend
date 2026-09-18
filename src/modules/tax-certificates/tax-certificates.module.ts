import { Module } from '@nestjs/common';
import {
  AdminTaxCertificatesController,
  AffiliateTaxCertificatesController,
} from './tax-certificates.controller';
import { TaxCertificatesService } from './tax-certificates.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [AdminTaxCertificatesController, AffiliateTaxCertificatesController],
  providers: [TaxCertificatesService],
  exports: [TaxCertificatesService],
})
export class TaxCertificatesModule {}
