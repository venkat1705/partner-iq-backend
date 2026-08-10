// backend/api/index.ts
import 'reflect-metadata';
import serverless from 'serverless-http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/AppModule';

let cachedHandler: any;

export default async function handler(req: any, res: any) {
  if (!cachedHandler) {
    const app = await NestFactory.create(AppModule, { cors: true });
    app.enableCors({
      origin: process.env.CORS_ORIGINS?.split(',') || [],
      credentials: true,
    });
    await app.init();

    const expressApp = app.getHttpAdapter().getInstance();
    cachedHandler = serverless(expressApp);
  }

  return cachedHandler(req, res);
}