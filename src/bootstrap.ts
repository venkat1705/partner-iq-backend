import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './AppModule';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { getAppConfig } from './config/app.config';
import { dbStore } from './database/store';
import { runSeed } from './database/seeds/run-seed';

export async function createPartnerIqApp() {
  await runSeed();
  await dbStore.initialize();

  const appConfig = getAppConfig();
  const app = await NestFactory.create(AppModule, { cors: true, rawBody: true });

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  });

  app.use(cookieParser());
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PartnerIQ API')
    .setDescription('Multi-Tenant B2B SaaS Affiliate & Partner Management Platform API')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'Authorization' }, 'ApiKey')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/', (_req: express.Request, res: express.Response) => {
    res.json({
      name: 'PartnerIQ API',
      status: 'online',
      docs: '/api/docs',
    });
  });

  return app;
}

export async function listen() {
  const logger = new Logger('PartnerIQServer');
  const appConfig = getAppConfig();
  const app = await createPartnerIqApp();

  await app.listen(appConfig.port, '0.0.0.0');
  logger.log(`PartnerIQ API running on port ${appConfig.port}`);
  logger.log(`Swagger documentation available at ${appConfig.appUrl}/api/docs`);
}
