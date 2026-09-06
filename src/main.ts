import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config();
import { listen } from './bootstrap';
import { PartnerIQWorker } from './workers/bullmq.worker';

async function bootstrap() {
  if (process.argv.includes('--worker')) {
    const worker = new PartnerIQWorker();
    worker.start();
    return;
  }

  await listen();
}

bootstrap();
