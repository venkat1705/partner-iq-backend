import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { randomBytes } from 'crypto';
import { AppModule } from './AppModule';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { getAppConfig } from './config/app.config';
import { dbStore } from './database/store';
import { runSeed } from './database/seeds/run-seed';
import { NotificationGateway } from './modules/notifications/notifications.gateway';

export async function createPartnerIqApp() {
  await runSeed();
  await dbStore.initialize();

  const appConfig = getAppConfig();
  const app = await NestFactory.create(AppModule, { cors: true, rawBody: true, bodyParser: false });

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  });

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
      contentSecurityPolicy: false,
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  let openApiDocument: ReturnType<typeof SwaggerModule.createDocument> | null = null;

  if (appConfig.enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('PartnerIQ API')
      .setDescription('PartnerIQ REST API v1, internal application APIs, SDK integration, and webhook documentation.')
      .setVersion('1.0.0')
      .addServer(appConfig.appUrl, 'Local API')
      .addServer('https://api.partneriq.in', 'Production API')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'PartnerIQ secret API key' }, 'ApiKey')
      .build();

    openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, openApiDocument);
  }

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/', (_req: express.Request, res: express.Response) => {
    res.json({
      name: 'PartnerIQ API',
      status: 'online',
      ...(appConfig.enableSwagger ? { docs: '/api/docs', openapi: '/openapi.json' } : {}),
    });
  });

  if (openApiDocument) {
    expressApp.get('/openapi.json', (_req: express.Request, res: express.Response) => {
      res.json(openApiDocument);
    });
  }

  return app;
}

export async function listen() {
  const logger = new Logger('PartnerIQServer');
  const appConfig = getAppConfig();
  const app = await createPartnerIqApp();
  const gateway = app.get(NotificationGateway);
  gateway.attachServer(app.getHttpServer());

  await app.listen(appConfig.port, '0.0.0.0');
  logger.log(`PartnerIQ API running on port ${appConfig.port}`);
  if (appConfig.enableSwagger) {
    logger.log(`Swagger documentation available at ${appConfig.appUrl}/api/docs`);
  }
  logger.log(`Realtime notifications available at ${appConfig.appUrl}/notifications`);
}
