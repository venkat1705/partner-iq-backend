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
import { getAppConfig, isAllowedCorsOrigin } from './config/app.config';
import { dbStore } from './database/store';
import { seedSystemDefaults, runSeed } from './database/seeds/run-seed';
import { NotificationGateway } from './modules/notifications/notifications.gateway';
import { DealsGateway } from './modules/realtime/deals.gateway';

export async function createPartnerIqApp() {
  if (process.env.SEED_DEMO_DATA === 'true') {
    await runSeed();
  } else {
    await seedSystemDefaults();
  }
  await dbStore.initialize();

  const appConfig = getAppConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true, bodyParser: false });

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || isAllowedCorsOrigin(origin, appConfig.corsOrigins)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Every custom header a browser client actually sends must be listed here.
    // A missing one fails the CORS preflight and the request never reaches the
    // server — the browser reports only "Failed to fetch", with no status code
    // and nothing in the server logs, which makes it look like an outage rather
    // than a configuration problem.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-request-id',
      'x-partneriq-environment',
      'X-PartnerIQ-Environment',
      // Affiliate Portal sends the active organization on every scoped request.
      'x-organization-id',
      // Billing checkout and add-on purchases are idempotent.
      'Idempotency-Key',
      // Refresh fallback for clients that cannot rely on the cookie.
      'X-Refresh-Token',
      // Developer portal API explorer.
      'X-PartnerIQ-Explorer-Mode',
      'Accept',
      'Origin',
      'Cookie',
    ],
    // Lets clients read the correlation id off a response when reporting issues.
    exposedHeaders: ['x-request-id'],
  });

  // Only trust the configured number of upstream reverse-proxy hops when resolving
  // req.ip / X-Forwarded-For — without this, Express ignores XFF entirely (so IP-based
  // rate limiting silently keys off the proxy's own IP for every client), and setting it
  // to `true` blindly would let a client spoof its own IP via the header. Default to 1
  // hop (a single load balancer/reverse proxy), matching typical PartnerIQ deployments.
  app.getHttpAdapter().getInstance().set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS || '1', 10));

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
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https:', 'wss:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
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

  const dealsGateway = app.get(DealsGateway);
  dealsGateway.attachServer(app.getHttpServer());

  await app.listen(appConfig.port, '0.0.0.0');
  logger.log(`PartnerIQ API running on port ${appConfig.port}`);
  if (appConfig.enableSwagger) {
    logger.log(`Swagger documentation available at ${appConfig.appUrl}/api/docs`);
  }
  logger.log(`Realtime notifications available at ${appConfig.appUrl}/notifications`);
  logger.log(`Realtime deals sync available at ${appConfig.appUrl}/ws/deals`);
}
