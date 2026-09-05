import { Module, forwardRef } from '@nestjs/common';
import { EmailDesignController } from './email-design.controller';
import { EmailDesignService } from './email-design.service';
import { AuthModule } from '../auth/auth.module';
import { TemplateResolverService } from './services/template-resolver.service';
import { TemplateRendererService } from './services/template-renderer.service';
import { EmailSuppressionService } from './services/email-suppression.service';
import { BrevoEmailProvider } from './providers/brevo-email.provider';
import { DevelopmentEmailProvider } from './providers/development-email.provider';
import { EmailProviderFactory } from './providers/email-provider.factory';
import { EmailQueueProducer } from './queue/email-queue.producer';
import { EmailQueueWorker } from './queue/email-queue.worker';
import { DomainEventEmailListener } from './listeners/domain-event-email.listener';

import { DocumentRendererService } from './services/document-renderer.service';
import { PdfGeneratorService } from './services/pdf-generator.service';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [EmailDesignController],
  providers: [
    EmailDesignService,
    TemplateResolverService,
    TemplateRendererService,
    EmailSuppressionService,
    DocumentRendererService,
    PdfGeneratorService,
    BrevoEmailProvider,
    DevelopmentEmailProvider,
    EmailProviderFactory,
    EmailQueueProducer,
    EmailQueueWorker,
    DomainEventEmailListener,
  ],
  exports: [
    EmailDesignService,
    TemplateResolverService,
    TemplateRendererService,
    EmailSuppressionService,
    DocumentRendererService,
    PdfGeneratorService,
    EmailQueueProducer,
    EmailQueueWorker,
    DomainEventEmailListener,
  ],
})
export class EmailDesignModule { }

export default EmailDesignModule;
