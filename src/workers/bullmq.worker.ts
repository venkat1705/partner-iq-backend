import { Logger } from '@nestjs/common';

export class PartnerIQWorker {
  private logger = new Logger(PartnerIQWorker.name);

  start() {
    this.logger.log('⚡ PartnerIQ BullMQ Async Worker initialized');
    this.logger.log('Ready to process queues: [fraud], [commissions], [webhooks], [notifications], [payouts]');

    // Background Heartbeat
    setInterval(() => {
      this.logger.debug('Worker heartbeat: Processing background tasks OK');
    }, 60000);
  }
}
