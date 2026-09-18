import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationProvider, IntegrationTestResult } from './provider.interface';

@Injectable()
export class HubSpotProvider implements IntegrationProvider {
  readonly provider = 'HUBSPOT';
  readonly category = 'CRM';

  validateConfiguration(credentials: Record<string, string>): void {
    const token = credentials.privateAppToken || credentials.token || credentials.apiKey;
    if (!token || token.trim().length === 0) {
      throw new BadRequestException('Private App Token is required for HubSpot integration.');
    }
  }

  async testConnection(credentials: Record<string, string>): Promise<IntegrationTestResult> {
    const token = (credentials.privateAppToken || credentials.token || credentials.apiKey || '').trim();
    if (!token) {
      return {
        success: false,
        message: 'The Private App Token was not provided.',
      };
    }

    try {
      const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: 'The credentials were rejected by HubSpot. Please verify your Private App Token and try again.',
        };
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        return {
          success: false,
          message: `HubSpot returned an error (${response.status}): ${errorBody.slice(0, 150) || 'API error'}`,
        };
      }

      return {
        success: true,
        message: 'PartnerIQ successfully connected to HubSpot.',
      };
    } catch (error: any) {
      return {
        success: false,
        // A transport failure is not a rejection: never let a blip mark a
        // healthy connection as broken.
        inconclusive: true,
        message: `Unable to reach HubSpot: ${error?.message || 'Network error'}`,
      };
    }
  }

  maskCredentials(credentials: Record<string, string>): Record<string, string> {
    const token = credentials.privateAppToken || credentials.token || credentials.apiKey || '';
    const last4 = token.length > 4 ? token.slice(-4) : '';
    return {
      privateAppToken: `••••••••••••${last4}`,
    };
  }
}

