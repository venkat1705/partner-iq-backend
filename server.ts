import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import { randomBytes } from 'crypto';
import { AppModule } from './src/AppModule';
import { GlobalExceptionFilter } from './src/common/filters/global-exception.filter';
import { TransformInterceptor } from './src/common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './src/common/interceptors/logging.interceptor';
import { dbStore } from './src/database/store';
import { seedSystemDefaults } from './src/database/seeds/run-seed';
import { getAppConfig } from './src/config/app.config';
import { PartnerIQWorker } from './src/workers/bullmq.worker';

async function bootstrap() {
  const logger = new Logger('PartnerIQServer');

  // Check worker flag
  if (process.argv.includes('--worker')) {
    const worker = new PartnerIQWorker();
    worker.start();
    return;
  }

  // Seed initial system defaults
  await seedSystemDefaults();
  await dbStore.initialize();

  const app = await NestFactory.create(AppModule, { rawBody: true, bodyParser: false });
  const appConfig = getAppConfig();

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  });

  // Express Middlewares
  app.use(cookieParser());
  app.use((req, res, next) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_${randomBytes(12).toString('hex')}`;
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  });
  app.use(express.json({
    limit: '10mb',
    verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disabled for local Swagger & iframe dev environment
    }),
  );

  // Global Interceptors & Filters
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // Swagger OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PartnerIQ API')
    .setDescription('Multi-Tenant B2B SaaS Affiliate & Partner Management Platform API')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'Authorization' }, 'ApiKey')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Serve PartnerIQ Interactive Admin Control Panel at root '/'
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/', (req: express.Request, res: express.Response) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PartnerIQ - Control Panel & API Suite</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
      </head>
      <body class="bg-slate-900 text-slate-100 min-h-screen p-6 md:p-12">
        <div class="max-w-5xl mx-auto space-y-8">
          <header class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
            <div>
              <div class="flex items-center gap-3">
                <span class="bg-indigo-500 text-white font-bold px-3 py-1 rounded-lg text-sm tracking-wide">PartnerIQ</span>
                <span class="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-2.5 py-0.5 rounded-full font-medium">Server Online (Port 3000)</span>
              </div>
              <h1 class="text-2xl font-bold mt-2">B2B SaaS Partner & Affiliate Management API</h1>
              <p class="text-slate-400 text-sm">Multi-Tenant Engine with Immutable Ledger, Fraud Scoring & Rotating Tokens</p>
            </div>
            <a href="/api/docs" target="_blank" class="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition shadow-lg shadow-indigo-600/30 flex items-center gap-2">
              📖 Open Swagger Documentation
            </a>
          </header>

          <div class="grid md:grid-cols-3 gap-6">
            <div class="bg-slate-800/60 border border-slate-700/60 p-5 rounded-xl space-y-2">
              <span class="text-slate-400 text-xs font-semibold uppercase tracking-wider">System Status</span>
              <p class="text-sm font-bold text-emerald-400">Operational</p>
              <p class="text-xs text-slate-400">All core services running</p>
            </div>
            <div class="bg-slate-800/60 border border-slate-700/60 p-5 rounded-xl space-y-2">
              <span class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Authentication</span>
              <p class="text-sm font-bold text-white">RBAC & JWT</p>
              <p class="text-xs text-slate-400">Multi-tenant token isolation active</p>
            </div>
            <div class="bg-slate-800/60 border border-slate-700/60 p-5 rounded-xl space-y-2">
              <span class="text-slate-400 text-xs font-semibold uppercase tracking-wider">API Documentation</span>
              <p class="text-sm font-mono text-indigo-300">/api/docs</p>
              <a href="/api/docs" target="_blank" class="inline-block text-xs text-indigo-400 hover:underline">Open Swagger UI ↗</a>
            </div>
          </div>

          <div class="bg-slate-800/40 border border-slate-800 p-6 rounded-xl space-y-4">
            <h2 class="text-lg font-bold text-white">Active Backend API Endpoints</h2>
            <div class="grid md:grid-cols-2 gap-3 text-sm font-mono">
              <div class="bg-slate-900/80 p-3 rounded border border-slate-800"><span class="text-emerald-400 font-bold">POST</span> /api/v1/auth/login</div>
              <div class="bg-slate-900/80 p-3 rounded border border-slate-800"><span class="text-indigo-400 font-bold">GET</span> /api/v1/auth/me</div>
              <div class="bg-slate-900/80 p-3 rounded border border-slate-800"><span class="text-indigo-400 font-bold">GET</span> /api/v1/organizations</div>
              <div class="bg-slate-900/80 p-3 rounded border border-slate-800"><span class="text-amber-400 font-bold">POST</span> /api/v1/conversions</div>
              <div class="bg-slate-900/80 p-3 rounded border border-slate-800"><span class="text-indigo-400 font-bold">GET</span> /api/v1/organizations/:id/commissions</div>
              <div class="bg-slate-900/80 p-3 rounded border border-slate-800"><span class="text-indigo-400 font-bold">GET</span> /api/v1/organizations/:id/fraud/reviews</div>
              <div class="bg-slate-900/80 p-3 rounded border border-slate-800"><span class="text-indigo-400 font-bold">GET</span> /api/v1/organizations/:id/payouts</div>
              <div class="bg-slate-900/80 p-3 rounded border border-slate-800"><span class="text-emerald-400 font-bold">GET</span> /r/:shortCode</div>
            </div>
          </div>

          <div class="flex items-center justify-between text-xs text-slate-500 pt-4 border-t border-slate-800">
            <span>PartnerIQ Backend v1.0.0</span>
            <span>Swagger UI available at <a href="/api/docs" class="text-indigo-400 hover:underline">/api/docs</a></span>
          </div>
        </div>
      </body>
      </html>
    `);
  });

  const port = appConfig.port;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 PartnerIQ Server running at http://0.0.0.0:${port}`);
  logger.log(`📖 Swagger Documentation available at http://0.0.0.0:${port}/api/docs`);
}

bootstrap();
