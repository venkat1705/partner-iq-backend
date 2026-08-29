import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HubSpotTokenService } from './hubspot-token.service';

@Injectable()
export class HubSpotApiClient {
  private readonly logger = new Logger(HubSpotApiClient.name);
  private readonly baseUrl = 'https://api.hubapi.com';

  constructor(private readonly tokenService: HubSpotTokenService) {}

  async get(connectionId: string, path: string) {
    return this.request(connectionId, 'GET', path);
  }

  async post(connectionId: string, path: string, body?: unknown) {
    return this.request(connectionId, 'POST', path, body);
  }

  async patch(connectionId: string, path: string, body?: unknown) {
    return this.request(connectionId, 'PATCH', path, body);
  }

  async request(connectionId: string, method: string, path: string, body?: unknown, retry = true): Promise<any> {
    const token = await this.tokenService.getAccessToken(connectionId);
    const started = Date.now();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && retry) {
      await this.tokenService.refreshAccessToken(connectionId);
      return this.request(connectionId, method, path, body, false);
    }

    const text = await response.text();
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text };
    }
    this.logger.debug(JSON.stringify({
      provider: 'HUBSPOT',
      connectionId,
      operation: `${method} ${path}`,
      durationMs: Date.now() - started,
      result: response.ok ? 'ok' : 'failed',
      statusCode: response.status,
    }));

    if (!response.ok) {
      const category = response.status === 403 ? 'MISSING_PERMISSION' : response.status === 429 ? 'RATE_LIMITED' : 'HUBSPOT_API_ERROR';
      const detail =
        payload?.message ||
        payload?.error_description ||
        payload?.error ||
        `HubSpot returned HTTP ${response.status}`;
      throw new BadRequestException({
        message: `HubSpot API request failed: ${detail}`,
        code: category,
        statusCode: response.status,
        hubSpotStatusCode: response.status,
        hubSpotCategory: payload?.category,
        hubSpotCorrelationId: payload?.correlationId,
      });
    }
    return payload;
  }

  async accessTokenInfo(accessToken: string) {
    const response = await fetch(`${this.baseUrl}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`);
    if (!response.ok) throw new BadRequestException('HubSpot token metadata check failed');
    return response.json() as Promise<any>;
  }
}
