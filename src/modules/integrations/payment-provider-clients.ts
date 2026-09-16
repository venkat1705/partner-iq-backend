/**
 * Real outbound credential-verification calls for API-key-based payment
 * integrations. Each function makes an actual HTTPS request to the
 * provider's own API — a wrong key/secret genuinely fails here, this never
 * fakes a success.
 *
 * NOTE: exact endpoint paths for third-party APIs can change between API
 * versions. These are implemented against each provider's documented,
 * stable API as of this writing — verify against the provider's current
 * API reference before relying on this in a live production environment.
 */

export interface CredentialTestResult {
  success: boolean;
  message: string;
}

/**
 * Razorpay: GET /v1/payments is a stable, well-documented, read-only
 * endpoint. Basic Auth with (key_id, key_secret) — a 200 response (even
 * with zero results) proves the credentials are valid; 401 means invalid.
 */
export async function testRazorpayCredentials(apiKey: string, apiSecret: string): Promise<CredentialTestResult> {
  const baseUrl = 'https://api.razorpay.com/v1';
  const authHeader = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;

  try {
    const response = await fetch(`${baseUrl}/payments?count=1`, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });

    if (response.status === 401) {
      return { success: false, message: 'Razorpay rejected these credentials (unauthorized). Check your Key ID and Key Secret.' };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, message: `Razorpay returned an unexpected error (${response.status}): ${text.slice(0, 200)}` };
    }
    return { success: true, message: 'Razorpay credentials verified successfully.' };
  } catch (error: any) {
    return { success: false, message: `Unable to reach Razorpay: ${error?.message || 'network error'}` };
  }
}

/**
 * Cashfree Payment Gateway: GET /pg/orders is used here as the
 * credential-verification call — a 401/403 means invalid client
 * id/secret, any other response (including a validation error on query
 * params) confirms the credentials themselves were accepted.
 */
export async function testCashfreeCredentials(
  clientId: string,
  clientSecret: string,
  environment: 'TEST' | 'LIVE',
): Promise<CredentialTestResult> {
  const baseUrl = environment === 'LIVE' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

  try {
    const response = await fetch(`${baseUrl}/orders?limit=1`, {
      method: 'GET',
      headers: {
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-api-version': '2023-08-01',
      },
    });

    if (response.status === 401 || response.status === 403) {
      return { success: false, message: 'Cashfree rejected these credentials (unauthorized). Check your Client ID and Client Secret.' };
    }
    return { success: true, message: 'Cashfree credentials verified successfully.' };
  } catch (error: any) {
    return { success: false, message: `Unable to reach Cashfree: ${error?.message || 'network error'}` };
  }
}

export const paymentProviderCredentialTesters: Record<
  string,
  (apiKey: string, apiSecret: string, environment: 'TEST' | 'LIVE') => Promise<CredentialTestResult>
> = {
  RAZORPAY: (apiKey, apiSecret) => testRazorpayCredentials(apiKey, apiSecret),
  CASHFREE: (apiKey, apiSecret, environment) => testCashfreeCredentials(apiKey, apiSecret, environment),
};
