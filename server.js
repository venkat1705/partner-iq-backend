"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const AppModule_1 = require("./src/AppModule");
const global_exception_filter_1 = require("./src/common/filters/global-exception.filter");
const transform_interceptor_1 = require("./src/common/interceptors/transform.interceptor");
const logging_interceptor_1 = require("./src/common/interceptors/logging.interceptor");
const store_1 = require("./src/database/store");
const run_seed_1 = require("./src/database/seeds/run-seed");
const app_config_1 = require("./src/config/app.config");
const bullmq_worker_1 = require("./src/workers/bullmq.worker");
async function bootstrap() {
    const logger = new common_1.Logger('PartnerIQServer');
    // Check worker flag
    if (process.argv.includes('--worker')) {
        const worker = new bullmq_worker_1.PartnerIQWorker();
        worker.start();
        return;
    }
    // Seed initial data
    await (0, run_seed_1.runSeed)();
    await store_1.dbStore.initialize();
    const app = await core_1.NestFactory.create(AppModule_1.AppModule, { cors: true });
    const appConfig = (0, app_config_1.getAppConfig)();
    // Express Middlewares
    app.use((0, cookie_parser_1.default)());
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: false, // Disabled for local Swagger & iframe dev environment
    }));
    // Global Interceptors & Filters
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    app.useGlobalFilters(new global_exception_filter_1.GlobalExceptionFilter());
    app.useGlobalInterceptors(new logging_interceptor_1.LoggingInterceptor(), new transform_interceptor_1.TransformInterceptor());
    // Swagger OpenAPI Documentation
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle('PartnerIQ API')
        .setDescription('Multi-Tenant B2B SaaS Affiliate & Partner Management Platform API')
        .setVersion('1.0.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
        .addApiKey({ type: 'apiKey', in: 'header', name: 'Authorization' }, 'ApiKey')
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
    swagger_1.SwaggerModule.setup('api/docs', app, document);
    // Serve PartnerIQ Interactive Admin Control Panel at root '/'
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.get('/', (req, res) => {
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
              <span class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Default Admin Account</span>
              <p class="text-sm font-mono text-emerald-300">admin@partneriq.demo</p>
              <p class="text-xs font-mono text-slate-400">Password: PartnerIQ@123</p>
            </div>
            <div class="bg-slate-800/60 border border-slate-700/60 p-5 rounded-xl space-y-2">
              <span class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Seeded Tenant</span>
              <p class="text-sm font-bold text-white">Acme SaaS</p>
              <p class="text-xs text-slate-400">4 Programs & Pre-configured Affiliate</p>
            </div>
            <div class="bg-slate-800/60 border border-slate-700/60 p-5 rounded-xl space-y-2">
              <span class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Test Tracking Link</span>
              <p class="text-xs font-mono text-indigo-300">/r/sarah</p>
              <a href="/r/sarah" target="_blank" class="inline-block text-xs text-indigo-400 hover:underline">Test Redirect ↗</a>
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
