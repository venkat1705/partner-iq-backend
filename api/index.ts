import 'reflect-metadata';
import serverless from 'serverless-http';
import { createPartnerIqApp } from '../src/bootstrap';

let cachedHandler: any;

export default async function handler(req: any, res: any) {
  if (!cachedHandler) {
    const app = await createPartnerIqApp();
    await app.init();
    const expressApp = app.getHttpAdapter().getInstance();
    cachedHandler = serverless(expressApp);
  }

  return cachedHandler(req, res);
}
